// Global pause switch for Liquid Glass backdrop capture during navigation.
//
// Why: on Android the glass library captures the window with a software draw
// every frame. A software draw also advances react-native-screens' legacy fade
// Animation; when the fade FINISHES inside that capture pass, the real hardware
// pass never repaints the final frame and the pushed screen stays stuck at
// whatever alpha it last had — a grey wash (~75%) or, when it was caught near
// the start of a fade-in, a BLACK screen (the dark window shows through).
// Pausing capture until the transition has really ended lets it finish on a
// real frame. iOS ignores `paused`.
//
// A fixed timer was not enough: on a slow phone a heavy screen (first open
// from the sidebar) can take longer than the timer just to build its native
// views, so its fade started AFTER glass had resumed → black screen. We now
// hold the pause until react-native-screens reports the transition ended
// (native-stack transitionStart/transitionEnd), with timers only as fallbacks.
import { useSyncExternalStore } from "react";

/** Waiting for a transition that hasn't reported transitionStart yet. */
const START_GRACE_MS = 2500;
/** Hard cap: never stay paused longer than this (lost end events). */
const MAX_PAUSE_MS = 4000;
/** After the last transitionEnd, let a couple of real frames land first. */
const SETTLE_MS = 120;
const REFRESH_AFTER_MS = 500;

let paused = false;
let generation = 0; // bumps per pause so stale timers/frames can't unpause a newer one
const active = new Set<string>(); // route keys mid-transition
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let capTimer: ReturnType<typeof setTimeout> | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function clear(t: ReturnType<typeof setTimeout> | null) {
  if (t) clearTimeout(t);
  return null;
}

function setPaused(v: boolean) {
  if (paused === v) return;
  paused = v;
  emit();
}

function hold(graceMs: number) {
  const gen = ++generation;
  releaseTimer = clear(releaseTimer);
  graceTimer = clear(graceTimer);
  setPaused(true);
  // No transition reported yet → resume after the grace period (screens with
  // animation:"none" never send transition events).
  graceTimer = setTimeout(() => {
    graceTimer = null;
    if (gen === generation && active.size === 0) release(gen);
  }, graceMs);
  capTimer = clear(capTimer);
  capTimer = setTimeout(() => {
    capTimer = null;
    if (gen !== generation) return;
    active.clear();
    release(gen);
  }, MAX_PAUSE_MS);
}

function release(gen: number) {
  releaseTimer = clear(releaseTimer);
  releaseTimer = setTimeout(() => {
    if (gen !== generation || active.size > 0) return;
    graceTimer = clear(graceTimer);
    capTimer = clear(capTimer);
    setPaused(false);
    // Refresh pulse: on BACK the revealed screen's glass resumes while the
    // popped screen may still be on its way out; re-pause for one frame a bit
    // later so every glass view takes a fresh capture of the settled screen.
    releaseTimer = setTimeout(() => {
      releaseTimer = null;
      if (gen !== generation) return;
      setPaused(true);
      requestAnimationFrame(() => {
        if (gen === generation) setPaused(false);
      });
    }, REFRESH_AFTER_MS);
  }, SETTLE_MS);
}

/** Call on every (animated) route change. */
export function pauseGlassForTransition() {
  hold(START_GRACE_MS);
}

/** native-stack `transitionStart` listener. */
export function glassTransitionStart(routeKey: string | undefined) {
  active.add(routeKey ?? "?");
  if (!paused || releaseTimer) hold(MAX_PAUSE_MS);
}

/** native-stack `transitionEnd` listener. */
export function glassTransitionEnd(routeKey: string | undefined) {
  active.delete(routeKey ?? "?");
  if (active.size === 0 && paused && !releaseTimer) release(generation);
}

export function useGlassPaused(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => paused,
    () => false,
  );
}
