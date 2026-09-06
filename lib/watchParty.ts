// Watch Party — synchronized "watch together" rooms over Supabase Realtime.
//
// One Realtime channel per room ("watch-party-<CODE>") carries BOTH:
//   • Presence  → who's in the room (avatar row in the overlay/lobby).
//   • Broadcast → the host's player state (episode, position, play/pause).
//
// The host broadcasts its state on a fixed 1.5s heartbeat; clients reconcile
// each beat against their local player (see computeSync). That single periodic
// message covers play, pause AND seek with no per-event wiring — the laziest
// correct sync. The drift tolerance (DRIFT_TOLERANCE_MS) is the "buffer window"
// so clients don't stutter chasing exact milliseconds.
//
// Battery (the hard requirement): the socket exists ONLY while in a room. It is
// torn down on AppState 'background' (and re-established on 'active'), and on a
// debounced unmount of the player — mirroring lib/presence.ts, which fixed the
// original background-drain bug. Nothing here keeps the radio awake idle.

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { router } from "expo-router";
import type { RealtimeChannel, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { computeSync, genCode, type PartyState } from "./watchPartySync";

export type { PartyState } from "./watchPartySync";
export { computeSync, DRIFT_TOLERANCE_MS } from "./watchPartySync";

export type PartyRole = "host" | "client";

/** Realtime channel health for the active room. */
export type PartyConnStatus = "idle" | "connecting" | "online" | "error";

export interface PartyMember {
  userId: string;
  name: string;
  avatarUrl: string | null;
  isHost: boolean;
  /** Has buffered enough to start watching. Drives the "ready" gate + indicators. */
  ready: boolean;
}

const HEARTBEAT_MS = 1500;
const DETACH_LEAVE_MS = 2000; // grace so an episode-hop remount keeps the room
// A failed subscribe (bad network on join, Realtime hiccup) used to be
// invisible: the joiner sat in the lobby on a spinner forever. Retry a fresh
// channel a bounded number of times, and surface the status to the UI.
const SUBSCRIBE_RETRY_MS = 3000;
const MAX_SUBSCRIBE_RETRIES = 5;
// The host's Start gate waits for every viewer to report ready. A viewer whose
// ready flag never lands (reconnect race, older build, desktop sibling) used
// to disable Start FOREVER — a permanent deadlock. After this hold the host
// may start anyway; late viewers catch up via the normal heartbeat seek.
const START_ANYWAY_MS = 20000;

// ── Channel state (one room at a time) ────────────────────────────
let channel: RealtimeChannel | null = null;
let room: { code: string; role: PartyRole; user: User } | null = null;
let appStateSub: { remove: () => void } | null = null;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;

let lastMembers: PartyMember[] = [];
let lastState: PartyState | null = null;
let connStatus: PartyConnStatus = "idle";
let subscribeRetries = 0;
let subscribeRetryTimer: ReturnType<typeof setTimeout> | null = null;
// This device's readiness for the current episode, mirrored into presence so the
// host can hold playback until everyone (including slow-internet clients) is ready.
let myReady = false;
// Last episode a client navigated to, so the immediate state replay on (re)mount
// can't re-fire router.replace and spin into an infinite remount loop.
let lastNavTarget: string | null = null;
const memberListeners = new Set<(m: PartyMember[]) => void>();
const stateListeners = new Set<(s: PartyState) => void>();
const controlListeners = new Set<(p: { episode: string; playing: boolean }) => void>();
const roomListeners = new Set<(r: { code: string; role: PartyRole } | null) => void>();
const connListeners = new Set<(s: PartyConnStatus) => void>();

function computeMembers(): PartyMember[] {
  if (!channel) return [];
  const state = channel.presenceState<{
    user_id: string;
    name: string;
    avatar_url: string | null;
    is_host: boolean;
    ready?: boolean;
  }>();
  const out: PartyMember[] = [];
  for (const presences of Object.values(state)) {
    if (!presences.length) continue;
    const p = presences[0];
    out.push({
      userId: p.user_id,
      name: p.name,
      avatarUrl: p.avatar_url ?? null,
      isHost: !!p.is_host,
      // Only an EXPLICIT `false` (a member that supports the gate and is still
      // buffering) holds the room. A member that doesn't report readiness at all
      // (undefined) — the desktop sibling app, or an older mobile build that
      // predates this flag — counts as ready so it can never deadlock the host.
      ready: p.ready !== false,
    });
  }
  // Host first, then by name.
  return out.sort((a, b) => (a.isHost === b.isHost ? a.name.localeCompare(b.name) : a.isHost ? -1 : 1));
}

function emitMembers() {
  lastMembers = computeMembers();
  for (const cb of memberListeners) cb(lastMembers);
}

function emitRoom() {
  const snap = room ? { code: room.code, role: room.role } : null;
  for (const cb of roomListeners) cb(snap);
}

function setConn(s: PartyConnStatus) {
  if (connStatus === s) return;
  connStatus = s;
  for (const cb of connListeners) cb(s);
}

/** Presence payload for this device — includes the live `myReady` flag. */
function presencePayload() {
  if (!room) return null;
  const { user, role } = room;
  const meta = user.user_metadata ?? {};
  const name =
    meta.full_name || meta.name || (user.email ? user.email.split("@")[0] : "User");
  const avatarUrl = meta.avatar_url || meta.picture || null;
  return {
    user_id: user.id,
    name,
    avatar_url: avatarUrl,
    is_host: role === "host",
    ready: myReady,
  };
}

/** Open + subscribe the channel for the current `room`, then track presence. */
async function openChannel(): Promise<void> {
  if (!room || channel) return;
  const { user, code } = room;
  setConn("connecting");

  channel = supabase.channel(`watch-party-${code}`, {
    config: { presence: { key: user.id }, broadcast: { self: false } },
  });

  channel
    .on("presence", { event: "sync" }, emitMembers)
    .on("presence", { event: "join" }, emitMembers)
    .on("presence", { event: "leave" }, emitMembers)
    .on("broadcast", { event: "control" }, ({ payload }) => {
      if (room?.role !== "host" || !payload || typeof payload.episode !== "string" || typeof payload.playing !== "boolean") return;
      for (const cb of controlListeners) cb(payload);
    })
    .on("broadcast", { event: "sync" }, ({ payload }) => {
      if (!payload || typeof payload.episode !== "string" || typeof payload.playing !== "boolean" ||
          !Number.isFinite(payload.positionMs) || payload.positionMs < 0 || !Number.isFinite(payload.at) ||
          !payload.params || Object.values(payload.params).some((v) => typeof v !== "string")) return;
      lastState = { ...payload, params: { ...payload.params,
        url4up: payload.params.url4up || payload.params.up4 || "",
        up4: payload.params.up4 || payload.params.url4up || "",
        url3rb: payload.params.url3rb || payload.params.a3rb || "",
        a3rb: payload.params.a3rb || payload.params.url3rb || "",
        animeTitle: payload.params.animeTitle || payload.params.title || "",
        title: payload.params.title || payload.params.animeTitle || "",
        epNum: payload.params.epNum || payload.params.ep || "",
        ep: payload.params.ep || payload.params.epNum || "",
      } } as PartyState;
      for (const cb of stateListeners) cb(lastState);
    })
    .subscribe(async (status) => {
      if (!channel) return;
      if (status === "SUBSCRIBED") {
        subscribeRetries = 0;
        setConn("online");
        const payload = presencePayload();
        if (payload) await channel.track(payload);
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // Was a silent death: the joiner spun in the lobby forever. Tear the
        // channel down and retry fresh a bounded number of times; the UI can
        // also offer a manual retry via reconnect().
        setConn("error");
        if (!room || subscribeRetries >= MAX_SUBSCRIBE_RETRIES) return;
        subscribeRetries += 1;
        const stale = channel;
        if (subscribeRetryTimer) clearTimeout(subscribeRetryTimer);
        subscribeRetryTimer = setTimeout(() => {
          if (!room || channel !== stale) return;
          void (async () => {
            await closeChannel();
            await openChannel();
          })();
        }, SUBSCRIBE_RETRY_MS);
      }
    });
}

/** Report this device's readiness for the current episode (re-tracks presence). */
export async function setReady(ready: boolean): Promise<void> {
  if (myReady === ready) return;
  myReady = ready;
  const payload = presencePayload();
  if (channel && payload) { try { await channel.track(payload); } catch {} }
}

/** Close the socket but KEEP `room` (used for background teardown). */
async function closeChannel(): Promise<void> {
  if (channel) {
    try { await channel.untrack(); } catch {}
    try { await supabase.removeChannel(channel); } catch {}
  }
  channel = null;
}

function ensureAppStateListener() {
  if (appStateSub) return;
  // Background → drop the socket (no idle radio). Foreground → reopen. This is
  // the battery guarantee; it runs only while a room is active.
  appStateSub = AppState.addEventListener("change", (s) => {
    if (!room) return;
    if (s === "active") openChannel().catch(() => {});
    else closeChannel().catch(() => {});
  });
}

// ── Public API ────────────────────────────────────────────────────

export function getRoom(): { code: string; role: PartyRole } | null {
  return room ? { code: room.code, role: room.role } : null;
}

export async function createRoom(user: User): Promise<string> {
  await leaveRoom();
  myReady = false;
  const code = genCode();
  room = { code, role: "host", user };
  ensureAppStateListener();
  await openChannel();
  emitRoom();
  return code;
}

export async function joinRoom(code: string, user: User): Promise<void> {
  await leaveRoom();
  myReady = false;
  room = { code: code.trim().toUpperCase(), role: "client", user };
  ensureAppStateListener();
  await openChannel();
  emitRoom();
}

/** Drop and re-open the channel (manual recovery from the error state). */
export async function reconnect(): Promise<void> {
  if (!room) return;
  subscribeRetries = 0;
  await closeChannel();
  await openChannel();
}

export async function leaveRoom(): Promise<void> {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
  if (subscribeRetryTimer) { clearTimeout(subscribeRetryTimer); subscribeRetryTimer = null; }
  subscribeRetries = 0;
  await closeChannel();
  room = null;
  myReady = false;
  lastMembers = [];
  lastState = null;
  lastNavTarget = null;
  if (appStateSub) { appStateSub.remove(); appStateSub = null; }
  setConn("idle");
  emitMembers();
  emitRoom();
}

/** Host only — broadcast current player state. No-op if not subscribed. */
export function sendState(state: PartyState): void {
  if (!channel || room?.role !== "host") return;
  channel.send({ type: "broadcast", event: "sync", payload: state });
}

export function subscribeMembers(cb: (m: PartyMember[]) => void): () => void {
  memberListeners.add(cb);
  cb(lastMembers);
  return () => { memberListeners.delete(cb); };
}

export function subscribeState(cb: (s: PartyState) => void): () => void {
  stateListeners.add(cb);
  if (lastState) cb(lastState);
  return () => { stateListeners.delete(cb); };
}

export function subscribeRoom(cb: (r: { code: string; role: PartyRole } | null) => void): () => void {
  roomListeners.add(cb);
  cb(room ? { code: room.code, role: room.role } : null);
  return () => { roomListeners.delete(cb); };
}

/** Channel health for the active room — fires immediately with the current value. */
export function subscribeStatus(cb: (s: PartyConnStatus) => void): () => void {
  connListeners.add(cb);
  cb(connStatus);
  return () => { connListeners.delete(cb); };
}

/** Cancel a pending debounced leave — the player (re)mounted. */
function attach(): void {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
}

/** Player unmounted: leave after a grace window so an episode-hop remount
 *  (router.replace tears down + rebuilds the watch screen) keeps the room.
 *  HOSTS are the exception: the lobby flow sends the host OUT of the player
 *  to browse for an episode, so a 2s unmount grace destroyed the room mid-
 *  browse and stranded every joiner on a permanent "waiting" spinner. A host
 *  only leaves by explicit leave or by backgrounding the app (AppState). */
function detach(): void {
  if (!room || room.role === "host") return;
  if (leaveTimer) clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => { void leaveRoom(); }, DETACH_LEAVE_MS);
}

// ── React hook wired into the watch screen ─────────────────────────

export function useWatchPartySync(opts: {
  player: any;
  episode?: string;
  navParams: Record<string, string>;
  paused: boolean;
  applyPaused: (paused: boolean) => void;
  /** This device has buffered enough to start — mirrored into the room. */
  selfReady?: boolean;
}) {
  const [role, setRole] = useState<PartyRole | null>(() => getRoom()?.role ?? null);
  const [code, setCode] = useState<string | null>(() => getRoom()?.code ?? null);
  const [members, setMembers] = useState<PartyMember[]>([]);
  const [hostPaused, setHostPaused] = useState(false);
  // Host gate: true from each new episode until everyone is ready (then playback
  // is released and the host can pause/play freely for the rest of the episode).
  const [released, setReleased] = useState(false);
  // Escape hatch: after START_ANYWAY_MS of holding, the host may start even if
  // some viewer never reported ready (deadlock insurance — see START_ANYWAY_MS).
  const [startAnywayAvailable, setStartAnywayAvailable] = useState(false);
  // Client: true until the host's first PLAYING broadcast for this episode.
  // Drives the "waiting for the host to start" overlay + suppresses the
  // player's self-heal watchdog while the hold is INTENTIONAL.
  const [waitingForHost, setWaitingForHost] = useState(false);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Debounced leave across episode-hop remounts (battery + survives router.replace).
  useEffect(() => { attach(); return () => detach(); }, []);

  // Track room create/join/leave that happen from the overlay or lobby.
  useEffect(() => subscribeRoom((r) => { setRole(r?.role ?? null); setCode(r?.code ?? null); }), []);
  useEffect(() => subscribeMembers(setMembers), []);

  // Mirror this device's readiness into presence so the host's gate can see it.
  useEffect(() => { void setReady(!!opts.selfReady); }, [opts.selfReady]);

  // New episode → re-arm the gate (everyone re-buffers, so wait again).
  useEffect(() => {
    setReleased(false);
    setStartAnywayAvailable(false);
    if (role === "client") setWaitingForHost(true);
  }, [opts.episode, role]);

  // Arm the start-anyway escape hatch once the gate has held long enough.
  useEffect(() => {
    if (role !== "host" || released || startAnywayAvailable) return;
    const t = setTimeout(() => setStartAnywayAvailable(true), START_ANYWAY_MS);
    return () => clearTimeout(t);
  }, [role, released, startAnywayAvailable, opts.episode]);

  // Readiness, viewers-only. The host (leader) drives the room and is never gated
  // on its own (paused) player — gating on it left the leader permanently "not
  // ready" and deadlocked the start. `every` over an empty list is vacuously
  // true, so a solo host's Start button is enabled immediately.
  const viewers = members.filter((m) => !m.isHost);
  const allReady = viewers.every((m) => m.ready);
  const readyCount = viewers.filter((m) => m.ready).length;
  const waitingCount = viewers.length - readyCount;

  // HOST gate: hold the player PAUSED until the host explicitly presses Start.
  // (Auto-start was removed — the host owns the moment everyone watches in sync.)
  // The Start button is enabled only once every viewer is ready, so pressing it
  // can never begin playback while someone is still resolving a source / on a
  // loading screen — exactly the "no buffering at start" guarantee.
  useEffect(() => {
    if (role !== "host" || released) return;
    optsRef.current.applyPaused(true);
  }, [role, released, opts.episode]);

  // Suppress the watch screen's autonomous auto-play while the host is gated, so
  // the source resolving (which buffers + flips the player ready) can't start the
  // video before the host releases the room.
  const holdPlayback = role === "host" && !released;

  // Build + broadcast the current player state RIGHT NOW (host only). Called from
  // every host control (play/pause/seek/skip/start) so viewers move in lock-step
  // instead of waiting up to one heartbeat — that's the "no delay" feel. The
  // optional `playingOverride` lets a caller send the post-action play state
  // before React's paused state has re-rendered into optsRef.
  const pulse = useCallback((playingOverride?: boolean) => {
    if (role === "client") {
      if (channel && typeof playingOverride === "boolean") void channel.send({ type: "broadcast", event: "control", payload: { episode: optsRef.current.episode, playing: playingOverride } });
      return;
    }
    if (role !== "host") return;
    const o = optsRef.current;
    if (typeof playingOverride === "boolean") o.paused = !playingOverride;
    if (!o.episode) return;
    let pos = 0;
    try { pos = Math.round((o.player?.currentTime ?? 0) * 1000); } catch {}
    sendState({
      episode: o.episode,
      params: o.navParams,
      positionMs: pos,
      playing: playingOverride ?? !o.paused,
      at: Date.now(),
    });
  }, [role]);

  useEffect(() => {
    if (role !== "host") return;
    const onControl = (p: { episode: string; playing: boolean }) => {
      const o = optsRef.current;
      if (p.episode !== o.episode || !released) return;
      o.paused = !p.playing;
      o.applyPaused(!p.playing);
      pulse(p.playing);
    };
    controlListeners.add(onControl);
    return () => { controlListeners.delete(onControl); };
  }, [role, released, pulse]);

  // HOST presses Start: release the gate once and begin playback for everyone.
  // Re-checks allReady so a stale tap can't start over a still-buffering viewer
  // — unless the escape hatch armed (startAnywayAvailable), which exists
  // precisely to break a viewer-never-ready deadlock. Broadcasts play in the
  // same tick.
  const start = useCallback(() => {
    if (role !== "host" || released || (!allReady && !startAnywayAvailable)) return;
    setReleased(true);
    optsRef.current.applyPaused(false);
    pulse(true);
  }, [role, released, allReady, startAnywayAvailable, pulse]);

  // HOST → broadcast the live player state every heartbeat.
  useEffect(() => {
    if (role !== "host") return;
    const iv = setInterval(() => {
      const o = optsRef.current;
      if (!o.episode) return;
      let pos = 0;
      try { pos = Math.round((o.player?.currentTime ?? 0) * 1000); } catch {}
      sendState({
        episode: o.episode,
        params: o.navParams,
        positionMs: pos,
        playing: !o.paused,
        at: Date.now(),
      });
    }, HEARTBEAT_MS);
    return () => clearInterval(iv);
  }, [role]);

  // CLIENT → follow the host on each broadcast.
  useEffect(() => {
    if (role !== "client") return;
    // Normalize so encoding / trailing-slash differences between the host's
    // broadcast and this device's decoded route param don't read as a mismatch
    // (which would otherwise re-navigate forever).
    const norm = (u?: string) => {
      if (!u) return "";
      try { return decodeURIComponent(u).replace(/\/+$/, ""); }
      catch { return u.replace(/\/+$/, ""); }
    };
    return subscribeState((s) => {
      const o = optsRef.current;
      setHostPaused(!s.playing);
      if (s.playing) setWaitingForHost(false);
      // Host moved to a different episode → reopen it locally (room persists).
      const target = norm(s.episode);
      if (target && target !== norm(o.episode)) {
        if (lastNavTarget === target) return; // already navigating there — no loop
        lastNavTarget = target;
        // auto:"1" → client skips the server-picker gate and plays immediately,
        // so it isn't stranded on the picker while the host is already playing.
        router.replace({ pathname: `/watch/${encodeURIComponent(s.episode)}`, params: { ...s.params, auto: "1" } });
        return;
      }
      lastNavTarget = null; // arrived on the right episode
      const p = o.player;
      if (!p) return;
      let localPos = 0;
      try { localPos = Math.round((p.currentTime ?? 0) * 1000); } catch {}
      const { shouldSeekTo, play } = computeSync(s, localPos, Date.now());
      if (shouldSeekTo != null) { try { p.currentTime = shouldSeekTo / 1000; } catch {} }
      o.applyPaused(!play);
    });
  }, [role]);

  return { role, code, members, hostPaused, allReady, readyCount, waitingCount, viewerCount: viewers.length, holdPlayback, released, start, startAnywayAvailable, waitingForHost, pulse, leaveParty: leaveRoom };
}
