// Share a rendered view as a PNG (Wrapped card).
//
// Needs two native modules that only exist in APK 4.1.0+: react-native-view-shot
// (capture) and expo-sharing (Android share sheet with a file). Both are
// required LAZILY behind presence checks — a top-level import would crash every
// older install that receives this JS over OTA (TurboModule getEnforcing /
// requireNativeModule throw at import time). Older installs fall back to
// sharing a link instead.

import { NativeModules, TurboModuleRegistry } from "react-native";

let cached: boolean | null = null;

export function canShareImage(): boolean {
  if (cached != null) return cached;
  try {
    const { requireOptionalNativeModule } = require("expo-modules-core") as typeof import("expo-modules-core");
    const sharing = requireOptionalNativeModule("ExpoSharing");
    let viewShot: unknown = null;
    try {
      viewShot = TurboModuleRegistry.get("RNViewShot");
    } catch {}
    viewShot = viewShot || (NativeModules as Record<string, unknown>).RNViewShot;
    cached = !!sharing && !!viewShot;
  } catch {
    cached = false;
  }
  return cached;
}

/** Capture `ref` as PNG and open the share sheet. False when unavailable/failed. */
export async function shareViewAsImage(ref: unknown, dialogTitle: string): Promise<boolean> {
  if (!canShareImage() || !ref) return false;
  try {
    const { captureRef } = require("react-native-view-shot") as typeof import("react-native-view-shot");
    const uri = await captureRef(ref as never, { format: "png", quality: 1, result: "tmpfile" });
    const Sharing = require("expo-sharing") as typeof import("expo-sharing");
    await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle, UTI: "public.png" });
    return true;
  } catch {
    return false;
  }
}
