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

// ── Channel state (one room at a time) ────────────────────────────
let channel: RealtimeChannel | null = null;
let room: { code: string; role: PartyRole; user: User } | null = null;
let appStateSub: { remove: () => void } | null = null;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;

let lastMembers: PartyMember[] = [];
let lastState: PartyState | null = null;
// This device's readiness for the current episode, mirrored into presence so the
// host can hold playback until everyone (including slow-internet clients) is ready.
let myReady = false;
// Last episode a client navigated to, so the immediate state replay on (re)mount
// can't re-fire router.replace and spin into an infinite remount loop.
let lastNavTarget: string | null = null;
const memberListeners = new Set<(m: PartyMember[]) => void>();
const stateListeners = new Set<(s: PartyState) => void>();
const roomListeners = new Set<(r: { code: string; role: PartyRole } | null) => void>();

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

  channel = supabase.channel(`watch-party-${code}`, {
    config: { presence: { key: user.id }, broadcast: { self: false } },
  });

  channel
    .on("presence", { event: "sync" }, emitMembers)
    .on("presence", { event: "join" }, emitMembers)
    .on("presence", { event: "leave" }, emitMembers)
    .on("broadcast", { event: "sync" }, ({ payload }) => {
      lastState = payload as PartyState;
      for (const cb of stateListeners) cb(lastState);
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED" && channel) {
        const payload = presencePayload();
        if (payload) await channel.track(payload);
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

export async function leaveRoom(): Promise<void> {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
  await closeChannel();
  room = null;
  myReady = false;
  lastMembers = [];
  lastState = null;
  lastNavTarget = null;
  if (appStateSub) { appStateSub.remove(); appStateSub = null; }
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

/** Cancel a pending debounced leave — the player (re)mounted. */
function attach(): void {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
}

/** Player unmounted: leave after a grace window so an episode-hop remount
 *  (router.replace tears down + rebuilds the watch screen) keeps the room. */
function detach(): void {
  if (!room) return;
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
  useEffect(() => { setReleased(false); }, [opts.episode]);

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
    if (role !== "host") return;
    const o = optsRef.current;
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

  // HOST presses Start: release the gate once and begin playback for everyone.
  // Re-checks allReady so a stale tap can't start over a still-buffering viewer
  // (the button is also disabled until then). Broadcasts play in the same tick.
  const start = useCallback(() => {
    if (role !== "host" || released || !allReady) return;
    setReleased(true);
    optsRef.current.applyPaused(false);
    pulse(true);
  }, [role, released, allReady, pulse]);

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

  return { role, code, members, hostPaused, allReady, readyCount, waitingCount, viewerCount: viewers.length, holdPlayback, released, start, pulse, leaveParty: leaveRoom };
}
