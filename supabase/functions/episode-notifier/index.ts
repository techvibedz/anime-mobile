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

// Only consider recently-reported episodes, and prune anything older than this.
const QUEUE_TTL_HOURS = 72;

interface TokenRow {
  user_id: string;
  token: string;
  notification_scope: string | null;
  enabled: boolean | null;
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
}

// Mirror of norm() in lib/notifications.ts — keep latin/digits + Arabic block.
function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Tokens, split by scope (default "all" matches the app default).
  const { data: tokenRows } = await supabase
    .from("push_tokens")
    .select("user_id, token, notification_scope, enabled");
  const mylistTokensByUser = new Map<string, string[]>();
  const allTokensByUser = new Map<string, string[]>();
  for (const r of (tokenRows ?? []) as TokenRow[]) {
    if (r.enabled === false) continue; // master switch off → skip this device
    const map = r.notification_scope === "mylist" ? mylistTokensByUser : allTokensByUser;
    const arr = map.get(r.user_id) ?? [];
    arr.push(r.token);
    map.set(r.user_id, arr);
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
      hrefs.add(f.href);
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
  const queue = (queueRows ?? []) as QueueRow[];

  const messages: PushMessage[] = [];
  let pushedCount = 0;

  // Claim (user, anime_key, episode) for dedup; true the first time only.
  async function claimEpisode(userId: string, animeKey: string, episode: number): Promise<boolean> {
    const { data: already } = await supabase
      .from("notified_episodes")
      .select("episode_number")
      .eq("user_id", userId)
      .eq("anime_key", animeKey)
      .eq("episode_number", episode)
      .maybeSingle();
    if (already) return false;
    await supabase.from("notified_episodes").insert({
      user_id: userId,
      anime_key: animeKey,
      episode_number: episode,
    });
    return true;
  }

  for (const q of queue) {
    const normTitle = norm(q.anime_title);

    // "all" users → everyone.
    for (const [userId, tokens] of allTokensByUser) {
      if (!(await claimEpisode(userId, q.anime_key, q.episode_number))) continue;
      for (const to of tokens) {
        messages.push(buildMessage(to, q));
        pushedCount++;
      }
    }

    // "mylist" users → only if this anime is in their favorites.
    for (const [userId, tokens] of mylistTokensByUser) {
      const hrefs = favHrefsByUser.get(userId);
      const titles = favTitlesByUser.get(userId);
      const matches =
        (q.anime_href && hrefs?.has(q.anime_href)) ||
        (q.anime_key && hrefs?.has(q.anime_key)) ||
        (normTitle && titles?.has(normTitle));
      if (!matches) continue;
      if (!(await claimEpisode(userId, q.anime_key, q.episode_number))) continue;
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
      pushed: pushedCount,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
