import { useEffect, useRef } from "react";
import { Animated, Easing, type ViewStyle } from "react-native";
import { C } from "../lib/theme";
import { useReducedMotion } from "../lib/motion";

interface ShimmerProps {
  style?: ViewStyle;
  borderRadius?: number;
}

export function Shimmer({ style, borderRadius = 8 }: ShimmerProps) {
  const opacity = useRef(new Animated.Value(0.25)).current;
  const reduced = useReducedMotion();

  useEffect(() => {
    // Reduced motion: skip the breathing loop entirely and rest at a calm,
    // legible static opacity. The skeleton still communicates "loading" by
    // shape; it just doesn't pulse.
    if (reduced) {
      opacity.setValue(0.4);
      return;
    }
    // isInteraction:false is critical — without it this infinite loop holds an
    // InteractionManager handle for as long as a skeleton is on screen, which
    // starves every runAfterInteractions callback (the launch update-modal
    // check, notifications setup, ad init) so they never run.
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.6,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(opacity, {
          toValue: 0.25,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    anim.start();
    // Stop the native loop on unmount so an orphaned skeleton (e.g. one left in a
    // frozen, off-top screen) can't keep a driver animation running indefinitely.
    return () => anim.stop();
  }, [opacity, reduced]);

  return (
    <Animated.View
      style={[{ backgroundColor: C.surface, borderRadius, opacity }, style]}
    />
  );
}
