import { type ReactNode } from "react";
import { View } from "react-native";
import { C } from "../lib/theme";

/** Navigator `screenLayout` body: each screen paints its own opaque dark
 *  canvas so fade transitions between (transparent) screens never show
 *  through. `screenLayout` is CALLED as a function — wrap it in an arrow at
 *  the call site and keep this hook-free. */
export function GlassScreenLayout({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, backgroundColor: C.void }}>{children}</View>;
}
