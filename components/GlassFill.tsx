import { Platform, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { C } from "../lib/theme";

/**
 * Drop-in replacement for the repeated `<BlurView><solid overlay/></BlurView>`
 * pattern used by every glass surface in the app.
 *
 * Real-time blur (expo-blur) re-blurs the underlying content every frame. On
 * Android — especially low-end devices — that's the single biggest source of
 * scroll / navigation jank, and because each surface already paints a ~65%
 * opaque solid overlay ON TOP of the blur, the blur is barely visible there
 * anyway. So on Android we skip the blur entirely and paint a slightly more
 * opaque solid fill (frosted look, ~zero cost). iOS keeps the real blur, where
 * it's cheap and looks great.
 *
 * Render inside a `overflow: "hidden"` rounded container, same as before.
 */
export function GlassFill({
  intensity = 20,
  iosColor = C.surfaceGlass,
  androidColor = "rgba(14,16,40,0.82)",
}: {
  intensity?: number;
  iosColor?: string;
  androidColor?: string;
}) {
  if (Platform.OS === "ios") {
    return (
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: iosColor }]} />
      </BlurView>
    );
  }
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: androidColor }]} />;
}
