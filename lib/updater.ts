import { Alert, Linking, Platform } from "react-native";
import * as Updates from "expo-updates";
import * as Application from "expo-application";
import Constants from "expo-constants";

export interface UpdateInfo {
  type: "apk" | "ota" | null;
  version?: string;
  apkUrl?: string;
  releaseNotes?: string;
  isForce?: boolean;
}

/**
 * Checks for APK update from GitHub version.json.
 * Returns null if no update, or UpdateInfo if a new APK is available.
 */
export async function checkForApkUpdate(): Promise<UpdateInfo | null> {
  try {
    const url =
      Constants.expoConfig?.extra?.versionJsonUrl ??
      "https://raw.githubusercontent.com/techvibedz/anime-mobile/master/version.json";

    const resp = await fetch(url, { cache: "no-cache" });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data?.version) return null;

    const currentVersion = Application.nativeApplicationVersion ?? "0.0.0";
    if (compareVersions(data.version, currentVersion) <= 0) return null;

    return {
      type: "apk",
      version: data.version,
      apkUrl: data.apk_url || null,
      releaseNotes: data.release_notes || null,
      isForce: data.force_update === true,
    };
  } catch {
    return null;
  }
}

/**
 * Checks for OTA update via Expo Updates (manual mode).
 * Fetches the update and returns info if one was applied.
 */
export async function checkForOtaUpdate(): Promise<UpdateInfo | null> {
  try {
    if (!Updates.isEnabled) return null;

    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return null;

    const result = await Updates.fetchUpdateAsync();
    if (!result.isNew) return null;

    return {
      type: "ota",
      version: (check.manifest as { runtimeVersion?: string } | undefined)?.runtimeVersion ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Applies a downloaded OTA update by reloading the app.
 */
export function applyOtaUpdate() {
  try {
    Updates.reloadAsync();
  } catch {}
}

/**
 * Opens the APK download URL in browser.
 */
export async function openApkDownload(url: string) {
  const supported = await Linking.canOpenURL(url);
  if (supported) {
    await Linking.openURL(url);
  }
}

/**
 * Shows the update prompt for APK or OTA.
 */
export function showUpdatePrompt(
  info: UpdateInfo,
  onUpdate: () => void,
  onDismiss?: () => void
) {
  if (info.type === "ota") {
    Alert.alert(
      "Update Available",
      "A new JS update is ready. Restart now to apply?",
      [
        { text: "Later", style: "cancel", onPress: onDismiss },
        {
          text: "Restart Now",
          style: "destructive",
          onPress: () => {
            onUpdate();
            applyOtaUpdate();
          },
        },
      ]
    );
  } else if (info.type === "apk") {
    const notes = info.releaseNotes ? `\n\nWhat's new:\n${info.releaseNotes}` : "";
    Alert.alert(
      "New Version Available",
      `Version ${info.version} is available.${notes}`,
      [
        {
          text: "Later",
          style: "cancel",
          onPress: onDismiss,
        },
        {
          text: "Download",
          style: "default",
          onPress: () => {
            onUpdate();
            if (info.apkUrl) {
              openApkDownload(info.apkUrl);
            }
          },
        },
      ],
      info.isForce ? { cancelable: false } : undefined
    );
  }
}

/**
 * Compares semver-like version strings.
 * Returns positive if a > b, negative if a < b, 0 if equal.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}
