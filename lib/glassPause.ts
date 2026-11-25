// Global pause switch for Liquid Glass backdrop capture during navigation.
//
// Why: on Android the glass library captures the whole window with a software
// draw every frame. When a screen-transition animation (react-native-screens'
// fade) finishes INSIDE that capture pass, the real hardware pass never gets
// the final frame, and the pushed screen stays partly transparent forever
// (measured: content stuck at ~75% opacity — looked like a grey wash over a
// white window, dimmed over a dark one). Pausing capture while a transition
// runs lets the animation end on a real frame. iOS ignores `paused`.
import { useSyncExternalStore } from "react";

const TRANSITION_MS = 700; // > rn-screens' fade (~250–350ms) with headroom
const REFRESH_AFTER_MS = 500;

let paused = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0; // bumps per transition so a stale refresh frame can't unpause a newer one
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Call on every route change. */
export function pauseGlassForTransition(ms = TRANSITION_MS) {
  if (timer) clearTimeout(timer);
  const gen = ++generation;
  if (!paused) {
    paused = true;
    emit();
  }
  timer = setTimeout(() => {
    paused = false;
    emit();
    // Refresh pulse: on BACK navigation the revealed screen's glass resumes
    // while the popped screen may still be on its way out, and then nothing
    // invalidates it again — it froze showing the old page's chrome (a grey
    // capsule-in-capsule). Re-pause for one frame a bit later so every glass
    // view takes a fresh capture of the settled screen.
    timer = setTimeout(() => {
      paused = true;
      emit();
      requestAnimationFrame(() => {
        if (gen !== generation) return;
        timer = null;
        paused = false;
        emit();
      });
    }, REFRESH_AFTER_MS);
  }, ms);
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
