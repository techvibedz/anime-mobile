import { type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { R } from "../lib/theme";

/**
 * Content panel (cards, segmented controls, inputs) in the Liquid Glass
 * system. Apple keeps Liquid Glass for floating chrome; the content layer is a
 * clean tonal surface with a hairline that catches light on its top edge.
 * Real refractive glass lives in <LiquidGlass>.
 */
export function Glass({
  children,
  style,
  radius = R.xl,
  pointerEvents,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  pointerEvents?: "box-none" | "none" | "box-only" | "auto";
}) {
  return (
    <View
      pointerEvents={pointerEvents}
      style={[
        {
          borderRadius: radius,
          overflow: "hidden",
          backgroundColor: "rgba(255,255,255,0.055)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.07)",
          borderTopColor: "rgba(255,255,255,0.14)",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
