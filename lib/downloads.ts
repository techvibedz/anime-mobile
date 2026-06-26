// Offline episode downloads.
//
// A download is a single progressive .mp4 file saved under the app's document
// directory, plus a metadata entry in an AsyncStorage index. The actual video
// URL is resolved the same way the player does (lib/api → resolveDownloadUrl),
// preferring vid3rb's direct 1080p .mp4. expo-file-system's resumable downloader
// streams the file with progress; the native module ships in the installed APK
// (the updater already uses it), so this works over an OTA.
//
// A tiny pub/sub lets the Downloads screen + episode cards re-render live as
// progress ticks. Downloads in flight when the app is killed can't be resumed
// (the resumable handle isn't persisted), so on load they're marked "failed" and
// the user can retry.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { resolveDownloadUrl } from "./api";

export type DownloadStatus = "resolving" | "downloading" | "completed" | "failed";

export interface DownloadItem {
  id: string;
  animeTitle: string;
  episodeTitle: string;
  epNum: number | null;
  image: string;
  animeHref: string;
  /** Canonical episode URL — de-dupe key + resume/progress key for the player. */
  episodeHref: string;
  url4up?: string;
  url3rb?: string;
  /** Local file:// path once the file exists. */
  fileUri: string;
  status: DownloadStatus;
  progress: number; // 0..1
  bytes: number;
  totalBytes: number;
  createdAt: number;
}

export interface DownloadMeta {
  animeTitle: string;
  episodeTitle: string;
  epNum: number | null;
  image: string;
  animeHref: string;
  episodeHref: string;
  url4up?: string;
  url3rb?: string;
  server?: { name: string; iframeUrl: string; provider: string; quality: string };
}

const INDEX_KEY = "@downloads_index_v1";
const DIR = `${FileSystem.documentDirectory}downloads/`;

let items: DownloadItem[] | null = null;
const active = new Map<string, ReturnType<typeof FileSystem.createDownloadResumable>>();
const listeners = new Set<() => void>();
let lastEmit = 0;

function emit(force = false) {
  const now = Date.now();
  // Throttle the high-frequency progress emits; always flush state changes.
  if (!force && now - lastEmit < 400) return;
  lastEmit = now;
  for (const fn of listeners) { try { fn(); } catch {} }
}

export function subscribeDownloads(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function idFor(episodeHref: string): string {
  let h = 0;
  const s = episodeHref || String(Math.random());
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return "dl_" + (h >>> 0).toString(36);
}

async function ensureDir() {
  try {
    const info = await FileSystem.getInfoAsync(DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  } catch {}
}

async function persist() {
  try {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(items ?? []));
  } catch {}
}

async function load(): Promise<DownloadItem[]> {
  if (items) return items;
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const parsed: DownloadItem[] = raw ? JSON.parse(raw) : [];
    // An in-flight download can't survive an app kill → mark it failed so the
    // user can retry instead of seeing a stuck spinner forever.
    items = parsed.map((it) =>
      it.status === "downloading" || it.status === "resolving"
        ? { ...it, status: "failed" as DownloadStatus }
        : it,
    );
  } catch {
    items = [];
  }
  return items;
}

export async function getDownloads(): Promise<DownloadItem[]> {
  const list = await load();
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

export async function getDownloadByEpisode(episodeHref: string): Promise<DownloadItem | undefined> {
  const list = await load();
  return list.find((it) => it.id === idFor(episodeHref));
}

function upsert(item: DownloadItem) {
  if (!items) items = [];
  const i = items.findIndex((x) => x.id === item.id);
  if (i === -1) items.push(item);
  else items[i] = item;
}

function patch(id: string, p: Partial<DownloadItem>) {
  if (!items) return;
  const i = items.findIndex((x) => x.id === id);
  if (i !== -1) items[i] = { ...items[i], ...p };
}

/**
 * Start (or restart) a download. Returns the item id. Resolves a direct .mp4
 * URL, then streams it to disk with live progress. Idempotent: an already-
 * completed episode just returns its existing item.
 */
export async function startDownload(meta: DownloadMeta): Promise<string> {
  await load();
  await ensureDir();
  const id = idFor(meta.episodeHref);

  const existing = items!.find((x) => x.id === id);
  if (existing && existing.status === "completed") return id;
  if (active.has(id)) return id; // already downloading

  const fileUri = `${DIR}${id}.mp4`;
  const item: DownloadItem = {
    id,
    animeTitle: meta.animeTitle,
    episodeTitle: meta.episodeTitle,
    epNum: meta.epNum,
    image: meta.image,
    animeHref: meta.animeHref,
    episodeHref: meta.episodeHref,
    url4up: meta.url4up,
    url3rb: meta.url3rb,
    fileUri: "",
    status: "resolving",
    progress: 0,
    bytes: 0,
    totalBytes: 0,
    createdAt: existing?.createdAt ?? Date.now(),
  };
  upsert(item);
  await persist();
  emit(true);

  try {
    const resolved = await resolveDownloadUrl({
      episodeHref: meta.episodeHref,
      url4up: meta.url4up,
      url3rb: meta.url3rb,
      epNum: meta.epNum,
      animeTitle: meta.animeTitle,
      server: meta.server,
    });
    if (!resolved) {
      patch(id, { status: "failed" });
      await persist();
      emit(true);
      return id;
    }

    patch(id, { status: "downloading", fileUri });
    emit(true);

    // Clear any stale partial file so a fresh download can't append to garbage.
    try { await FileSystem.deleteAsync(fileUri, { idempotent: true }); } catch {}

    const resumable = FileSystem.createDownloadResumable(
      resolved.url,
      fileUri,
      { headers: resolved.headers },
      (p) => {
        const total = p.totalBytesExpectedToWrite;
        patch(id, {
          bytes: p.totalBytesWritten,
          totalBytes: total > 0 ? total : 0,
          progress: total > 0 ? p.totalBytesWritten / total : 0,
        });
        emit();
      },
    );
    active.set(id, resumable);

    const result = await resumable.downloadAsync();
    active.delete(id);
    if (!result?.uri) {
      patch(id, { status: "failed" });
    } else {
      patch(id, { status: "completed", fileUri: result.uri, progress: 1 });
    }
    await persist();
    emit(true);
  } catch {
    active.delete(id);
    patch(id, { status: "failed" });
    await persist();
    emit(true);
  }
  return id;
}

export async function retryDownload(id: string): Promise<void> {
  const list = await load();
  const it = list.find((x) => x.id === id);
  if (!it) return;
  await startDownload({
    animeTitle: it.animeTitle,
    episodeTitle: it.episodeTitle,
    epNum: it.epNum,
    image: it.image,
    animeHref: it.animeHref,
    episodeHref: it.episodeHref,
    url4up: it.url4up,
    url3rb: it.url3rb,
  });
}

export async function deleteDownload(id: string): Promise<void> {
  await load();
  const it = items!.find((x) => x.id === id);
  // Cancel an in-flight download so its callback can't resurrect the entry.
  const res = active.get(id);
  if (res) { try { await res.cancelAsync(); } catch {} active.delete(id); }
  if (it?.fileUri) { try { await FileSystem.deleteAsync(it.fileUri, { idempotent: true }); } catch {} }
  items = items!.filter((x) => x.id !== id);
  await persist();
  emit(true);
}

/** Human-readable total size of completed downloads (for the screen header). */
export function formatBytes(n: number): string {
  if (!n || n <= 0) return "0 MB";
  const mb = n / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(0)} MB`;
}
