// Entrance motion primitive for the Holo rollout. Uses React Native's CORE
// Animated (not Reanimated) on purpose: Reanimated 4 needs a native worklets
// TurboModule compiled into the binary, which OTA updates can't add — importing
// it crashes the live app ("installTurboModule ... expected argument count: 0").
// RN Animated runs opacity/transform on the native thread (useNativeDriver) for
// 60fps and ships fine over OTA. Fade + rise, reduced-motion aware.

import { useEffect, useRef, type ReactNode } from "react";
import { Animated, type ViewStyle, type StyleProp } from "react-native";
import { useReducedMotion } from "../lib/motion";

export function Rise({
  children,
  delay = 0,
  distance = 12,
  duration = 400,
  style,
}: {
  children: ReactNode;
  /** Stagger offset in ms (e.g. index * 70). */
  delay?: number;
  /** How far it rises from, in px. */
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  // Start at 1 (no anim) when reduced motion is on, so content is never gated on
  // a transition — it's just immediately present.
  const p = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) return;
    const anim = Animated.timing(p, {
      toValue: 1,
      duration,
      delay,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [reduced]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: p,
          transform: [
            { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
