import { type ReactNode } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import { LiquidGlassView, type GlassPresetProps } from "react-native-liquid-glassmorphism";
import { useGlassPaused } from "../lib/glassPause";

type Preset = "navigationBar" | "floatingTabBar" | "cardOverMedia" | "compactControl" | "frosted" | "crystal";

/**
 * Real Liquid Glass (react-native-liquid-glassmorphism):
 *  - iOS 26: Apple's native UIGlassEffect.
 *  - Android 13+: per-frame backdrop capture → blur → AGSL refractive lens
 *    (edge refraction, chromatic dispersion, Fresnel rim, specular).
 *  - Android 12: RenderEffect blur + tint; older: translucent tint.
 *
 * Use it for FLOATING CHROME over content (tab bar, top bars, floating
 * buttons) — that's where Apple uses it, and each view captures its backdrop
 * every frame, so keep the count per screen small. Over a solid background
 * the refraction has nothing to bend; content cards use <Glass> panels.
 */
export function LiquidGlass({
  children,
  style,
  radius,
  preset = "compactControl",
  interactive,
  tintColor,
  variant,
  legibilityFloor,
  thickness,
  edgeReflectionStrength,
  pointerEvents,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius: number;
  preset?: Preset;
  interactive?: boolean;
  tintColor?: string;
  variant?: GlassPresetProps["variant"];
  legibilityFloor?: number;
  thickness?: number;
  /** Mirrored "echo" band at the rim (Android). Keep low over text/busy art. */
  edgeReflectionStrength?: number;
  pointerEvents?: "box-none" | "none" | "box-only" | "auto";
}) {
  // Capture is suspended while a screen transition runs (see lib/glassPause).
  const paused = useGlassPaused();
  return (
    <LiquidGlassView
      paused={paused}
      preset={preset}
      borderRadius={radius}
      interactive={interactive}
      tintColor={tintColor}
      variant={variant}
      legibilityFloor={legibilityFloor}
      thickness={thickness}
      edgeReflectionStrength={edgeReflectionStrength}
      pointerEvents={pointerEvents}
      style={[{ borderRadius: radius, overflow: "hidden" }, style]}
    >
      {children}
    </LiquidGlassView>
  );
}
