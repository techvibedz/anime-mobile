// Reduced-motion awareness — OTA-safe, no native module.
//
// The OS "Reduce Motion" accessibility switch is exposed by React Native's
// AccessibilityInfo (no extra native dependency, so this ships over OTA). The
// design system treats reduced motion as REQUIRED: auto-advancing carousels,
// looping shimmer breathing, and entrance transitions must fall back to a
// crossfade or instant state when the user opts out. Gate that motion on
// `useReducedMotion()`; never gate content *visibility* on an animation.

import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

let lastKnown = false;
// Prime the cached value once at module load so the first render of any consumer
// already reflects the OS setting instead of flashing motion-on for a frame.
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v) => { lastKnown = !!v; })
  .catch(() => {});

/**
 * Reactive "Reduce Motion" flag. Starts from the last-known OS value and updates
 * live when the user toggles the setting while the app is open.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(lastKnown);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => { if (alive) { lastKnown = !!v; setReduced(!!v); } })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => {
      lastKnown = !!v;
      if (alive) setReduced(!!v);
    });
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  return reduced;
}

/** Non-reactive snapshot for imperative paths (timers, one-shot effects). */
export function reduceMotionNow(): boolean {
  return lastKnown;
}
