import { useEffect, useRef } from "react";
import { Animated, Easing, type ViewStyle } from "react-native";
import { C } from "../lib/theme";

interface ShimmerProps {
  style?: ViewStyle;
  borderRadius?: number;
}

export function Shimmer({ style, borderRadius = 8 }: ShimmerProps) {
  const opacity = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    // isInteraction:false is critical — without it this infinite loop holds an
    // InteractionManager handle for as long as a skeleton is on screen, which
    // starves every runAfterInteractions callback (the launch update-modal
    // check, notifications setup, ad init) so they never run.
    Animated.loop(
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
    ).start();
  }, [opacity]);

  return (
    <Animated.View
      style={[{ backgroundColor: C.surface, borderRadius, opacity }, style]}
    />
  );
}
