// Reduced-motion awareness — OTA-safe, no native module.
//
// The OS "Reduce Motion" accessibility switch is exposed by React Native's
// AccessibilityInfo (no extra native dependency, so this ships over OTA). The
// design system treats reduced motion as REQUIRED: auto-advancing carousels,
// looping shimmer breathing, and entrance transitions must fall back to a
// crossfade or instant state when the user opts out. Gate that motion on
// `useReducedMotion()`; never gate content *visibility* on an animation.

import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

// ONE OS query + ONE listener for the whole app. Every poster/cover calls this
// hook; it used to start its own native isReduceMotionEnabled() call, its own
// listener and a follow-up setState per mounted card — a burst of bridge work
// for every cell a rail mounted mid-scroll (felt as rail stutter on low-end
// phones). Now consumers just read a module value.
let lastKnown = false;
const listeners = new Set<() => void>();
const publish = (v: boolean) => {
  if (v === lastKnown) return;
  lastKnown = v;
  listeners.forEach((l) => l());
};
// Prime once at module load so the first render of any consumer already
// reflects the OS setting instead of flashing motion-on for a frame.
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v) => publish(!!v))
  .catch(() => {});
try {
  AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => publish(!!v));
} catch {}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
const snapshot = () => lastKnown;

/**
 * Reactive "Reduce Motion" flag. Starts from the last-known OS value and updates
 * live when the user toggles the setting while the app is open.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Non-reactive snapshot for imperative paths (timers, one-shot effects). */
export function reduceMotionNow(): boolean {
  return lastKnown;
}
