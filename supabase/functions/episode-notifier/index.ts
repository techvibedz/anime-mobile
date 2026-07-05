// Pantoufa — episode-notifier Edge Function
//
// Runs on a schedule (pg_cron, ~every 15 min) AND is nudged by the app right
// after it uploads new episodes. It fans out the `episode_queue` — the witanime
// "recently updated" feed reported by the app — as Expo push notifications WITH
// the episode image, even when the app is closed.
//
// Why the queue (and not an airing API): the app's sources (witanime/anime4up)
// are behind Cloudflare, which blocks datacenter IPs, so a server can't scrape
// them. An external airing schedule (e.g. AniList) fires at Japanese broadcast
// time — BEFORE the Arabic sub is published — so it would notify for episodes
// that aren't available in the app yet. Instead, the app (which CAN scrape, via
// its hidden WebView) reports episodes that are genuinely available, and the
// server just delivers them. The feed is shared: any one signed-in user opening
// the app keeps it fresh for everyone.
//
// Per-user scope (push_tokens.notification_scope):
//   • "all"    → push every queued episode.
//   • "mylist" → push only episodes whose anime is in that user's favorites.
// Dedup is per-user via notified_episodes so an episode is pushed at most once.
//
// Deploy:   supabase functions deploy episode-notifier --no-verify-jwt
// Env (auto-provided by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHANNEL_ID = "new-episodes";

// Sample cover used by the in-app "send test notification" button so the user
// can verify closed-app + image delivery on demand (AniList CDN is stable).
const TEST_IMAGE =
  "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21-tXMN3Y20PIL9.jpg";

const JSON_HEADERS = { "Content-Type": "application/json" };

// Only consider recently-reported episodes, and prune anything older than this.
const QUEUE_TTL_HOURS = 72;

interface TokenRow {
  user_id: string;
  token: string;
  notification_scope: string | null;
  enabled: boolean | null;
  updated_at: string | null;
}

interface Favorite {
  user_id: string;
  href: string;
  title: string;
}

interface QueueRow {
  episode_key: string;
  anime_key: string;
  anime_title: string;
  anime_href: string;
  episode_title: string | null;
  episode_href: string | null;
  episode_number: number;
  image: string | null;
  created_at: string;
}

// Rows in episode_queue are inserted by ANY signed-in user (shared feed). Before
// fanning them out as push to everyone, sanitize attacker-controllable fields:
// clamp the title, require a sane episode number, and drop images from hosts that
// aren't known scrape-source CDNs. Dropping a bad image still delivers the text
// push — we never drop a whole notification here, only untrusted rich content.
// NOTE: witanime rotates TLDs (.life/.you/...), so match the source name as a
// domain label under any TLD. If a NEW scrape source/CDN is added later, add it
// here or its images will be dropped from pushes.
const IMG_HOST_ALLOW = /(?:^|\.)(?:witanime|anime4up|anime3rb)\.[a-z]{2,}$/i;

function safeImage(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    return IMG_HOST_ALLOW.test(u.hostname) ? url : null;
  } catch {
    return null;
  }
}

function sanitizeRow(q: QueueRow): QueueRow {
  const title = (q.anime_title || "").slice(0, 80);
  const ep = Number.isFinite(q.episode_number) ? Math.trunc(q.episode_number) : 0;
  return { ...q, anime_title: title, episode_number: ep, image: safeImage(q.image) };
}

function isPlausibleRow(q: QueueRow): boolean {
  return !!q.anime_title && q.episode_number > 0 && q.episode_number < 100000;
}

// Mirror of norm() in lib/notifications.ts — keep latin/digits + Arabic block.
function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Stabilize a per-anime key across witanime's rotating TLD (.life/.you/...).
// The app builds anime_key from the FULL anime URL, so the SAME episode reported
// by a client resolving a different TLD becomes a DIFFERENT key — which used to
// defeat BOTH dedup layers (episode_queue PK + notified_episodes) and re-push
// episodes users had already seen. We collapse the host to its second-level
// label (drop the TLD) + path, e.g. witanime/anime/one-piece, so .life and .you
// map to one identity. Different sources keep distinct labels (witanime vs
// anime4up), so cross-source slugs can't collide. Non-URL keys (title fallback)
// pass through lower/trimmed. MUST stay byte-identical to normAnimeKey() in
// lib/notifications.ts AND to the SQL used to migrate notified_episodes.
function normAnimeKey(k: string): string {
  if (!k) return "";
  try {
    const u = new URL(k);
    const host = u.hostname.replace(/^www\./, "");
    const labels = host.split(".");
    const sld = labels.length >= 2 ? labels[labels.length - 2] : host;
    return (sld + u.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return k.trim().toLowerCase();
  }
}

/* ── Expo push ─────────────────────────────────────────────────── */

interface PushMessage {
  to: string;
  title: string;
  body: string;
  sound: "default";
  channelId: string;
  priority: "high";
  data: Record<string, unknown>;
  richContent?: { image: string };
}

function buildMessage(to: string, q: QueueRow): PushMessage {
  const msg: PushMessage = {
    to,
    title: "حلقة جديدة! 🎬",
    body: `${q.anime_title} — الحلقة ${q.episode_number} متوفرة الآن`,
    sound: "default",
    channelId: CHANNEL_ID,
    priority: "high",
    data: {
      animeHref: q.anime_href,
      episodeHref: q.episode_href,
      episodeNumber: q.episode_number,
      image: q.image,
    },
  };
  if (q.image) msg.richContent = { image: q.image };
  return msg;
}

async function sendExpoPush(messages: PushMessage[]) {
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(chunk),
      });
    } catch (e) {
      console.error("expo push chunk failed", e);
    }
  }
}

/* ── Main ──────────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // The cron invokes us with an empty body; the app nudges us with {} too. Only
  // the in-app "send test" button passes { test: true } (with the caller's JWT).
  let body: { test?: boolean } = {};
  try { body = await req.json(); } catch { /* no/empty body → normal run */ }

  // ── Test path: deliver ONE sample notification (with image) to just the
  // caller's own device(s). Bypasses the queue + dedup so it can be re-run any
  // time to confirm closed-app push works. Scoped to the authenticated user so
  // it can't be used to spam others.
  if (body?.test === true) {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let userId: string | null = null;
    if (jwt) {
      const { data } = await supabase.auth.getUser(jwt);
      userId = data?.user?.id ?? null;
    }
    if (!userId) {
      return new Response(JSON.stringify({ ok: false, error: "unauthenticated" }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }
    const { data: rows } = await supabase
      .from("push_tokens")
      .select("token, enabled")
      .eq("user_id", userId);
    const tokens = ((rows ?? []) as { token: string; enabled: boolean | null }[])
      .filter((r) => r.enabled !== false)
      .map((r) => r.token);
    if (tokens.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "no_tokens" }), {
        headers: JSON_HEADERS,
      });
    }
    const testMessages: PushMessage[] = tokens.map((to) => ({
      to,
      title: "إشعار تجريبي 🎬",
      body: "هذا إشعار تجريبي — الإشعارات تعمل بشكل صحيح ✅",
      sound: "default",
      channelId: CHANNEL_ID,
      priority: "high",
      data: { test: true },
      richContent: { image: TEST_IMAGE },
    }));
    await sendExpoPush(testMessages);
    return new Response(JSON.stringify({ ok: true, test: true, sent: tokens.length }), {
      headers: JSON_HEADERS,
    });
  }

  // 1. Tokens, split by scope (default "all" matches the app default).
  const { data: tokenRows } = await supabase
    .from("push_tokens")
    .select("user_id, token, notification_scope, enabled, updated_at");
  const mylistTokensByUser = new Map<string, string[]>();
  const allTokensByUser = new Map<string, string[]>();
  // Latest token (re)registration time per user, in ms. The app re-registers
  // (bumping updated_at) on every sign-in, so this is "when this user's current
  // device last started listening". We never push an episode that predates it.
  const tokenRegByUser = new Map<string, number>();
  for (const r of (tokenRows ?? []) as TokenRow[]) {
    if (r.enabled === false) continue; // master switch off → skip this device
    const map = r.notification_scope === "mylist" ? mylistTokensByUser : allTokensByUser;
    const arr = map.get(r.user_id) ?? [];
    arr.push(r.token);
    map.set(r.user_id, arr);
    const reg = r.updated_at ? Date.parse(r.updated_at) : 0;
    if (reg > (tokenRegByUser.get(r.user_id) ?? 0)) tokenRegByUser.set(r.user_id, reg);
  }

  // 2. Favorites → per-user match sets (only needed for "mylist" users).
  const favHrefsByUser = new Map<string, Set<string>>();
  const favTitlesByUser = new Map<string, Set<string>>();
  if (mylistTokensByUser.size > 0) {
    const { data: favs } = await supabase.from("favorites").select("user_id, href, title");
    for (const f of (favs ?? []) as Favorite[]) {
      if (!mylistTokensByUser.has(f.user_id)) continue;
      let hrefs = favHrefsByUser.get(f.user_id);
      if (!hrefs) { hrefs = new Set(); favHrefsByUser.set(f.user_id, hrefs); }
      // Store the TLD-normalized key so a favorite saved under one witanime TLD
      // still matches a queue row reported under another (mirrors the dedup key).
      hrefs.add(normAnimeKey(f.href));
      let titles = favTitlesByUser.get(f.user_id);
      if (!titles) { titles = new Set(); favTitlesByUser.set(f.user_id, titles); }
      const nt = norm(f.title);
      if (nt) titles.add(nt);
    }
  }

  // 3. Recent queue rows (the witanime feed the app reported).
  const cutoff = new Date(Date.now() - QUEUE_TTL_HOURS * 3600 * 1000).toISOString();
  const { data: queueRows } = await supabase
    .from("episode_queue")
    .select("*")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(500);
  const sanitized = ((queueRows ?? []) as QueueRow[]).filter(isPlausibleRow).map(sanitizeRow);
  // Collapse rows that are the SAME episode under different witanime TLDs
  // (.life vs .you) to one, keeping the earliest (rows arrive created_at-asc).
  // Halves the work below and removes any dependence on claim ordering.
  const queueByKey = new Map<string, QueueRow>();
  for (const q of sanitized) {
    const ek = `${normAnimeKey(q.anime_key)}#${q.episode_number}`;
    if (!queueByKey.has(ek)) queueByKey.set(ek, q);
  }
  const queue = [...queueByKey.values()];

  // ── Flood guard: never push episodes that predate the token ──────
  // The bug this fixes: the OLD guard only protected users with ZERO notification
  // history. But a RETURNING user (signs out — which DELETES their push token —
  // then signs back in, or reinstalls) still has old history, so they were treated
  // as "established" and blasted with the ENTIRE 72h queue backlog the instant
  // they signed in: a flood of "old episodes".
  //
  // Correct rule: an episode only pushes to a user if it entered the queue AFTER
  // that user's CURRENT push token registered (updated_at, bumped on every sign-in).
  // Every queue episode older than the token is silently recorded as already-seen
  // and never pushed. This covers brand-new AND returning users in one rule.
  const relevantUserIds = new Set<string>([
    ...allTokensByUser.keys(),
    ...mylistTokensByUser.keys(),
  ]);
  // True when this episode predates the user's current token → seed, don't push.
  const predatesToken = (userId: string, q: QueueRow) =>
    Date.parse(q.created_at) < (tokenRegByUser.get(userId) ?? 0);

  let seededCount = 0;
  if (queue.length > 0) {
    const seedRows: { user_id: string; anime_key: string; episode_number: number }[] = [];
    for (const userId of relevantUserIds) {
      for (const q of queue) {
        if (predatesToken(userId, q)) {
          seedRows.push({ user_id: userId, anime_key: normAnimeKey(q.anime_key), episode_number: q.episode_number });
        }
      }
    }
    seededCount = seedRows.length;
    // Bulk-record the pre-token backlog as already-seen (idempotent), in chunks.
    for (let i = 0; i < seedRows.length; i += 500) {
      await supabase
        .from("notified_episodes")
        .upsert(seedRows.slice(i, i + 500), {
          onConflict: "user_id,anime_key,episode_number",
          ignoreDuplicates: true,
        });
    }
  }

  const messages: PushMessage[] = [];
  let pushedCount = 0;

  // Claim (user, anime_key, episode) for dedup; true the first time only.
  // `animeKey` MUST already be normalized (normAnimeKey) so .life/.you collapse.
  // Race-safe: a bare INSERT lets the unique constraint arbitrate when the cron
  // and an app-nudge run concurrently — the loser sees 23505 and skips, instead
  // of a SELECT-then-INSERT gap that would double-push.
  async function claimEpisode(userId: string, animeKey: string, episode: number): Promise<boolean> {
    const { error } = await supabase.from("notified_episodes").insert({
      user_id: userId,
      anime_key: animeKey,
      episode_number: episode,
    });
    return !error; // 23505 (already claimed) or any error → don't push
  }

  for (const q of queue) {
    const normTitle = norm(q.anime_title);
    const nKey = normAnimeKey(q.anime_key); // TLD-stable dedup identity

    // "all" users → everyone whose token predates nothing for this episode.
    for (const [userId, tokens] of allTokensByUser) {
      if (predatesToken(userId, q)) continue; // older than token → seeded silently above
      if (!(await claimEpisode(userId, nKey, q.episode_number))) continue;
      for (const to of tokens) {
        messages.push(buildMessage(to, q));
        pushedCount++;
      }
    }

    // "mylist" users → only if this anime is in their favorites. Favorite hrefs
    // are stored TLD-normalized, so compare against normalized keys too.
    for (const [userId, tokens] of mylistTokensByUser) {
      if (predatesToken(userId, q)) continue; // older than token → seeded silently above
      const hrefs = favHrefsByUser.get(userId);
      const titles = favTitlesByUser.get(userId);
      const matches =
        (nKey && hrefs?.has(nKey)) ||
        (q.anime_href && hrefs?.has(normAnimeKey(q.anime_href))) ||
        (normTitle && titles?.has(normTitle));
      if (!matches) continue;
      if (!(await claimEpisode(userId, nKey, q.episode_number))) continue;
      for (const to of tokens) {
        messages.push(buildMessage(to, q));
        pushedCount++;
      }
    }
  }

  await sendExpoPush(messages);

  // Housekeeping: drop queue rows past the TTL.
  try {
    await supabase.from("episode_queue").delete().lt("created_at", cutoff);
  } catch { /* ignore */ }

  return new Response(
    JSON.stringify({
      ok: true,
      queued: queue.length,
      allUsers: allTokensByUser.size,
      mylistUsers: mylistTokensByUser.size,
      seededRows: seededCount,
      pushed: pushedCount,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
