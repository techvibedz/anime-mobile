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
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.6,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.25,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
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
