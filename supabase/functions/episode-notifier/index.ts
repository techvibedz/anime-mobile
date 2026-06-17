// Pantoufa — episode-notifier Edge Function
//
// Runs on a schedule (pg_cron / Supabase scheduled function, ~every 15 min).
// For every anime in any user's favorites it asks AniList whether a newer
// episode has aired since we last checked, and if so sends an Expo push
// (with the AniList cover image) to each user who follows that anime.
//
// Why AniList and not scraping: the app's sources (witanime/anime4up) are
// behind Cloudflare, which blocks datacenter IPs. AniList is a free, open API
// with airing schedules + cover art, so a server can use it. Titles are matched
// best-effort (Latin search term derived from the witanime href slug, falling
// back to the stored title) — obscure / Arabic-only titles may not resolve.
//
// Deploy:   supabase functions deploy episode-notifier --no-verify-jwt
// Schedule: see supabase/notifications.sql notes / Supabase dashboard → Cron.
//
// Env (auto-provided by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANILIST_URL = "https://graphql.anilist.co";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHANNEL_ID = "new-episodes";

interface Favorite {
  user_id: string;
  href: string;
  title: string;
  image: string | null;
}

interface AnimeGroup {
  key: string;
  title: string;
  href: string;
  image: string | null;
  userIds: Set<string>;
}

interface Mapping {
  key: string;
  anilist_id: number | null;
  title: string | null;
  image: string | null;
  last_aired_episode: number;
  not_found: boolean;
}

/* ── Title helpers ─────────────────────────────────────────────── */

// Mirror of norm() in lib/notifications.ts — keep latin/digits + Arabic block.
function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Derive a Latin search term from a witanime/anime4up href slug, e.g.
// "https://witanime.com/anime/one-piece/" → "one piece". Anime sites slug
// titles in romaji/English even when the display title is Arabic, which makes
// AniList matching far more reliable than searching the Arabic title.
function searchTermFromHref(href: string, fallbackTitle: string): string {
  try {
    const m = href.match(/\/anime\/([^/?#]+)/i);
    if (m && m[1]) {
      const slug = decodeURIComponent(m[1]).replace(/[-_]+/g, " ").trim();
      // Only trust the slug if it's actually Latin text.
      if (/[a-z]/i.test(slug)) return slug;
    }
  } catch { /* ignore */ }
  return fallbackTitle;
}

/* ── AniList ───────────────────────────────────────────────────── */

interface AniListResult {
  id: number;
  title: string;
  image: string | null;
  lastAired: number;
}

async function resolveAniList(search: string): Promise<AniListResult | null> {
  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        id
        episodes
        status
        nextAiringEpisode { episode }
        title { romaji english native }
        coverImage { extraLarge large }
      }
    }`;
  try {
    const resp = await fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { search } }),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const m = json?.data?.Media;
    if (!m) return null;
    // Last aired = the episode before the next-to-air one; if the show has
    // finished airing, all its episodes are out.
    const lastAired = m.nextAiringEpisode?.episode
      ? Math.max(0, m.nextAiringEpisode.episode - 1)
      : (m.status === "FINISHED" ? (m.episodes ?? 0) : 0);
    return {
      id: m.id,
      title: m.title?.english || m.title?.romaji || m.title?.native || search,
      image: m.coverImage?.extraLarge || m.coverImage?.large || null,
      lastAired,
    };
  } catch {
    return null;
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

async function sendExpoPush(messages: PushMessage[]) {
  // Expo accepts up to 100 messages per request.
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

  // 1. All favorites across all users.
  const { data: favs, error: favErr } = await supabase
    .from("favorites")
    .select("user_id, href, title, image");
  if (favErr) {
    return new Response(JSON.stringify({ error: favErr.message }), { status: 500 });
  }
  const favorites = (favs ?? []) as Favorite[];
  if (favorites.length === 0) {
    return new Response(JSON.stringify({ ok: true, checked: 0, pushed: 0 }));
  }

  // 2. Group favorites by normalized title → unique anime.
  const groups = new Map<string, AnimeGroup>();
  for (const f of favorites) {
    const key = norm(f.title) || f.href;
    let g = groups.get(key);
    if (!g) {
      g = { key, title: f.title, href: f.href, image: f.image, userIds: new Set() };
      groups.set(key, g);
    }
    g.userIds.add(f.user_id);
  }

  // 3. Push tokens per user.
  const { data: tokenRows } = await supabase.from("push_tokens").select("user_id, token");
  const tokensByUser = new Map<string, string[]>();
  for (const r of (tokenRows ?? []) as { user_id: string; token: string }[]) {
    const arr = tokensByUser.get(r.user_id) ?? [];
    arr.push(r.token);
    tokensByUser.set(r.user_id, arr);
  }

  // 4. Existing mappings.
  const { data: mapRows } = await supabase.from("anime_mappings").select("*");
  const mappings = new Map<string, Mapping>();
  for (const m of (mapRows ?? []) as Mapping[]) mappings.set(m.key, m);

  const messages: PushMessage[] = [];
  let pushedCount = 0;

  for (const g of groups.values()) {
    const existing = mappings.get(g.key);

    // Resolve AniList if we've never looked this anime up before.
    let anilistId = existing?.anilist_id ?? null;
    let coverImage = existing?.image ?? g.image ?? null;
    let resolvedTitle = existing?.title ?? g.title;
    let lastAired: number;
    const isFirstSeen = !existing;

    if (!existing || existing.anilist_id == null) {
      const search = searchTermFromHref(g.href, g.title);
      const res = await resolveAniList(search);
      if (!res) {
        // Record the miss so we don't hammer AniList every run.
        await supabase.from("anime_mappings").upsert({
          key: g.key,
          title: g.title,
          image: g.image,
          anilist_id: null,
          not_found: true,
          last_aired_episode: existing?.last_aired_episode ?? 0,
          last_checked: new Date().toISOString(),
        });
        continue;
      }
      anilistId = res.id;
      coverImage = res.image || coverImage;
      resolvedTitle = res.title;
      lastAired = res.lastAired;
    } else {
      // Re-check airing for an already-resolved anime.
      const res = await resolveAniList(existing.title || g.title);
      lastAired = res?.lastAired ?? existing.last_aired_episode;
      if (res?.image) coverImage = res.image;
    }

    const prevAired = existing?.last_aired_episode ?? 0;

    // Persist the latest state.
    await supabase.from("anime_mappings").upsert({
      key: g.key,
      anilist_id: anilistId,
      title: resolvedTitle,
      image: coverImage,
      last_aired_episode: Math.max(prevAired, lastAired),
      not_found: false,
      last_checked: new Date().toISOString(),
    });

    // First time we ever see this anime → seed silently (no backlog spam).
    if (isFirstSeen) continue;
    // Nothing newer aired.
    if (lastAired <= prevAired || lastAired <= 0) continue;

    // New episode! Notify each follower (deduped) for the newest episode.
    for (const userId of g.userIds) {
      // Per-user dedup.
      const { data: already } = await supabase
        .from("notified_episodes")
        .select("episode_number")
        .eq("user_id", userId)
        .eq("anime_key", g.key)
        .eq("episode_number", lastAired)
        .maybeSingle();
      if (already) continue;

      await supabase.from("notified_episodes").insert({
        user_id: userId,
        anime_key: g.key,
        episode_number: lastAired,
      });

      const tokens = tokensByUser.get(userId) ?? [];
      for (const to of tokens) {
        const msg: PushMessage = {
          to,
          title: "حلقة جديدة! 🎬",
          body: `${resolvedTitle} — الحلقة ${lastAired} متوفرة الآن`,
          sound: "default",
          channelId: CHANNEL_ID,
          priority: "high",
          data: { animeHref: g.href, episodeNumber: lastAired, image: coverImage },
        };
        if (coverImage) msg.richContent = { image: coverImage };
        messages.push(msg);
        pushedCount++;
      }
    }
  }

  await sendExpoPush(messages);

  return new Response(
    JSON.stringify({ ok: true, animeChecked: groups.size, pushed: pushedCount }),
    { headers: { "Content-Type": "application/json" } },
  );
});
