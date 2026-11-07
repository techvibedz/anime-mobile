// Anime → manga bridge: "the anime ended here — continue from chapter N".
//
// Read path: get_manga_bridge RPC (shared row + community vote summary). A
// miss (or a stale airing show) asks the companion edge function's "bridge"
// mode once, which grounds itself on AniList and stores the answer for every
// device. Opening resolves the manga in the Arabic manga sources and jumps
// straight into the reader at the continue chapter.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { invokeAiFunction } from "./companion";
import { animeTitleKey } from "./history";
import { isSupabaseConfigured, supabase } from "./supabase";
import {
  bridgeSearchTitles,
  pickChapter,
  resolveBridgeView,
  type BridgePayload,
  type BridgeView,
  type BridgeVote,
} from "./mangaBridgeCore";

export * from "./mangaBridgeCore";

export interface BridgeInfo {
  key: string;
  payload: BridgePayload;
  votes: BridgeVote[];
  mine: number | null;
  view: BridgeView;
}

const CACHE_PREFIX = "@manga_bridge_v1:";
const CACHE_TTL = 12 * 60 * 60 * 1000;
const AIRING_STALE_MS = 4 * 24 * 60 * 60 * 1000;

/** Per-season key shared by every device (title key already carries season words). */
export function bridgeKey(animeTitle: string, season: number): string {
  const base = animeTitleKey(animeTitle);
  if (!base) return "";
  return season > 1 ? `${base}|s${season}` : base;
}

const mem = new Map<string, BridgeInfo | null>();
const inflight = new Map<string, Promise<BridgeInfo | null>>();

async function readRpc(key: string): Promise<{ payload: BridgePayload | null; updatedAt: number; votes: BridgeVote[]; mine: number | null } | null> {
  const { data, error } = await supabase.rpc("get_manga_bridge", { p_anime_key: key });
  if (error || !data || typeof data !== "object") return null;
  const d = data as { payload?: BridgePayload | null; updated_at?: string | null; votes?: { ch: number | string; n: number }[]; mine?: number | string | null };
  return {
    payload: d.payload ?? null,
    updatedAt: d.updated_at ? Date.parse(d.updated_at) : 0,
    votes: (d.votes ?? []).map((v) => ({ ch: Number(v.ch), n: Number(v.n) })).filter((v) => v.ch > 0 && v.n > 0),
    mine: d.mine != null ? Number(d.mine) : null,
  };
}

/**
 * Bridge info for an anime season, or null when unknown / not applicable.
 * `refresh` skips the local caches (after voting).
 */
export function getMangaBridge(ctx: {
  animeTitle: string;
  altTitle?: string;
  season?: number;
  totalEpisodes?: number | null;
  refresh?: boolean;
}): Promise<BridgeInfo | null> {
  const key = bridgeKey(ctx.animeTitle, ctx.season ?? 0);
  if (!key || !isSupabaseConfigured) return Promise.resolve(null);
  if (!ctx.refresh && mem.has(key)) return Promise.resolve(mem.get(key) ?? null);
  const existing = inflight.get(key);
  if (existing && !ctx.refresh) return existing;
  const p = (async (): Promise<BridgeInfo | null> => {
    try {
      if (!ctx.refresh) {
        const raw = await AsyncStorage.getItem(CACHE_PREFIX + key).catch(() => null);
        if (raw) {
          const c = JSON.parse(raw) as { at: number; info: BridgeInfo | null };
          if (Date.now() - c.at < CACHE_TTL) {
            // Re-derive the view so logic changes apply to cached rows too.
            const info = c.info ? { ...c.info, view: resolveBridgeView(c.info.payload, c.info.votes) } : null;
            mem.set(key, info);
            return info;
          }
        }
      }
      let row = await readRpc(key);
      if (!row) return mem.get(key) ?? null; // network/RPC failure: keep what we had
      const stale = !!row.payload?.airing && Date.now() - row.updatedAt > AIRING_STALE_MS;
      if (!row.payload || stale) {
        const res = await invokeAiFunction<{ payload?: BridgePayload }>({
          mode: "bridge",
          animeKey: key,
          animeTitle: ctx.animeTitle,
          altTitle: ctx.altTitle || undefined,
          seasonNumber: ctx.season || undefined,
          totalEpisodes: ctx.totalEpisodes || undefined,
          force: stale || undefined,
        }, 32_000);
        if (res.ok && res.data.payload) row = { ...row, payload: res.data.payload };
        else if (!row.payload) return null; // try again next visit
      }
      const payload = row.payload!;
      const info: BridgeInfo = {
        key,
        payload,
        votes: row.votes,
        mine: row.mine,
        view: resolveBridgeView(payload, row.votes),
      };
      mem.set(key, info);
      AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), info })).catch(() => {});
      return info;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export async function voteMangaBridge(key: string, endChapter: number): Promise<boolean> {
  if (!key || !(endChapter > 0) || endChapter >= 10000) return false;
  try {
    const { error } = await supabase.rpc("vote_manga_bridge", { p_anime_key: key, p_end_chapter: endChapter });
    if (error) return false;
    mem.delete(key);
    await AsyncStorage.removeItem(CACHE_PREFIX + key).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the bridged manga in the Arabic manga sources and open it at
 * `chapter` (reader), or its detail page when that chapter isn't uploaded.
 */
export async function openBridgeChapter(
  payload: BridgePayload,
  animeTitle: string,
  chapter: number | null,
): Promise<"reader" | "detail" | "notfound"> {
  const [{ searchMergedManga, strictTitleScore, fetchMergedDetail }, nav] = await Promise.all([
    import("./manga/aggregate"),
    import("./manga/nav"),
  ]);
  const titles = bridgeSearchTitles(payload, animeTitle);
  let best: { card: import("./manga/types").MangaCard; score: number } | null = null;
  for (const title of titles) {
    let cards: import("./manga/types").MangaCard[] = [];
    try {
      cards = await searchMergedManga(title);
    } catch {}
    for (const card of cards) {
      const score = Math.max(...titles.map((t) => strictTitleScore(t, card.title)));
      if (score >= 0.86 && (!best || score > best.score)) best = { card, score };
    }
    if (best && best.score >= 0.98) break;
  }
  if (!best) return "notfound";
  const card = best.card;
  if (chapter != null) {
    try {
      const detail = await fetchMergedDetail(card.source, card.id);
      const ch = pickChapter(detail.chapters, chapter);
      if (ch) {
        nav.openMangaReader({
          source: card.source,
          mangaId: card.id,
          mangaTitle: detail.title || card.title,
          cover: detail.cover ?? card.cover,
          chapter: { source: ch.source, mangaId: ch.mangaId, id: ch.id, number: ch.number },
        });
        return "reader";
      }
    } catch {}
  }
  nav.openMangaDetail({ source: card.source, id: card.id, title: card.title, cover: card.cover });
  return "detail";
}
