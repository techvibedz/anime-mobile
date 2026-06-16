// AppLovin MAX ads — central config + helpers.
//
// The app is backend-free and ships off-store, so AppLovin MAX is used (its
// SDK is maintained, supports the New Architecture, and is tolerant of the
// content/distribution model — unlike AdMob). The native module autolinks
// during `expo prebuild` / EAS build; nothing runs in Expo Go.
//
// ── SETUP (one-time, in the AppLovin dashboard at https://dash.applovin.com) ──
//   1. Account → Keys → copy the "SDK Key" into APPLOVIN_SDK_KEY below.
//   2. MAX → Ad Units → create TWO Android ad units:
//        • one BANNER        → paste its ID into BANNER (android) below
//        • one INTERSTITIAL  → paste its ID into INTERSTITIAL (android) below
//   Until real values replace the PASTE_ placeholders, every helper here is a
//   safe no-op and <AdBanner/> renders nothing — so the app never crashes.

import { Platform } from "react-native";
import type AppLovinMAXType from "react-native-applovin-max";
import type { InterstitialAd as InterstitialAdType } from "react-native-applovin-max";

// IMPORTANT: do NOT statically import react-native-applovin-max. Its module
// graph runs `TurboModuleRegistry.getEnforcing('AppLovinMAX')` at import time,
// which THROWS if the native module isn't compiled into the running app. An
// OTA bundle shipped onto an APK built before AppLovin was added would then
// crash on launch. Require it lazily instead — and only from code paths that
// run once a real SDK key is configured (i.e. only in a native build that
// actually bundled the module). Until then every helper here is a no-op and
// the package is never required, so the import-time crash can't happen.
function loadMax(): {
  AppLovinMAX: typeof AppLovinMAXType;
  InterstitialAd: typeof InterstitialAdType;
} {
  const mod = require("react-native-applovin-max");
  return { AppLovinMAX: mod.default, InterstitialAd: mod.InterstitialAd };
}

// ── Paste your real values here ──────────────────────────────────────────────
export const APPLOVIN_SDK_KEY = "PASTE_YOUR_APPLOVIN_SDK_KEY";

const AD_UNITS = {
  banner: Platform.select({ android: "PASTE_ANDROID_BANNER_AD_UNIT_ID", default: "" })!,
  interstitial: Platform.select({ android: "PASTE_ANDROID_INTERSTITIAL_AD_UNIT_ID", default: "" })!,
};
// ─────────────────────────────────────────────────────────────────────────────

export const BANNER_AD_UNIT_ID = AD_UNITS.banner;
export const INTERSTITIAL_AD_UNIT_ID = AD_UNITS.interstitial;

// Master switch — flip to false to disable all ads without ripping out code.
const ADS_ENABLED = true;

// At most one interstitial per this window, so episode-hopping never spams ads.
const MIN_INTERSTITIAL_GAP_MS = 3 * 60 * 1000;

const isPlaceholder = (s: string) => !s || s.startsWith("PASTE_");

/** True once the SDK key is set — gates initialization. */
const keyReady = () => ADS_ENABLED && !isPlaceholder(APPLOVIN_SDK_KEY);

/** True when the banner can be shown (key + banner unit configured). */
export const bannerConfigured = () => keyReady() && !isPlaceholder(BANNER_AD_UNIT_ID);

/** True when interstitials are configured (key + interstitial unit). */
const interstitialConfigured = () => keyReady() && !isPlaceholder(INTERSTITIAL_AD_UNIT_ID);

let initialized = false;
let lastInterstitialAt = 0;

/** Initialize the AppLovin SDK once, near app start. Safe to call repeatedly. */
export async function initAds(): Promise<void> {
  if (initialized || !keyReady()) return;
  initialized = true;
  try {
    const { AppLovinMAX } = loadMax();
    AppLovinMAX.setVerboseLogging(__DEV__);
    await AppLovinMAX.initialize(APPLOVIN_SDK_KEY);
    setupInterstitial();
  } catch {
    // Let a later call retry (e.g. transient native init failure).
    initialized = false;
  }
}

/** Wire interstitial listeners and preload the first ad. */
function setupInterstitial(): void {
  if (!interstitialConfigured()) return;
  const { InterstitialAd } = loadMax();
  // Preload the next ad as soon as one is dismissed or fails, so there's
  // almost always one ready by the next natural break.
  InterstitialAd.addAdHiddenEventListener(() => InterstitialAd.loadAd(INTERSTITIAL_AD_UNIT_ID));
  InterstitialAd.addAdFailedToDisplayEventListener(() => InterstitialAd.loadAd(INTERSTITIAL_AD_UNIT_ID));
  InterstitialAd.addAdLoadFailedEventListener(() => {
    // Back off before retrying a failed load (no fill / network).
    setTimeout(() => InterstitialAd.loadAd(INTERSTITIAL_AD_UNIT_ID), 15000);
  });
  InterstitialAd.loadAd(INTERSTITIAL_AD_UNIT_ID);
}

/**
 * Show an interstitial at a natural break (e.g. opening an episode), but only
 * if one is ready and the frequency cap has elapsed. Never blocks the UX:
 * if no ad is ready it just warms one up for next time.
 */
export async function maybeShowInterstitial(placement?: string): Promise<void> {
  if (!initialized || !interstitialConfigured()) return;
  const now = Date.now();
  if (now - lastInterstitialAt < MIN_INTERSTITIAL_GAP_MS) return;
  try {
    const { InterstitialAd } = loadMax();
    const ready = await InterstitialAd.isAdReady(INTERSTITIAL_AD_UNIT_ID);
    if (!ready) {
      InterstitialAd.loadAd(INTERSTITIAL_AD_UNIT_ID);
      return;
    }
    lastInterstitialAt = now;
    InterstitialAd.showAd(INTERSTITIAL_AD_UNIT_ID, placement ?? null);
  } catch {
    // Swallow — ads must never break playback navigation.
  }
}
