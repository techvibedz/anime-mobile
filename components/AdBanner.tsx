import { View, type ViewStyle } from "react-native";
import { BANNER_AD_UNIT_ID, bannerConfigured } from "../lib/ads";

// Adaptive AppLovin banner. Renders nothing until a real banner ad unit ID is
// configured in lib/ads.ts, so it's invisible/no-op during development.
//
// react-native-applovin-max is required lazily (only once the banner is
// actually configured) because importing it runs a getEnforcing() native
// lookup that throws when the native module isn't in the app — which would
// crash any OTA shipped onto an APK built before AppLovin was added.
export function AdBanner({ style }: { style?: ViewStyle }) {
  if (!bannerConfigured()) return null;
  const { AdView, AdFormat } = require("react-native-applovin-max");
  return (
    <View style={[{ alignItems: "center", justifyContent: "center", width: "100%" }, style]}>
      <AdView
        adUnitId={BANNER_AD_UNIT_ID}
        adFormat={AdFormat.BANNER}
        adaptiveBannerEnabled
        autoRefresh
        style={{ width: "100%", height: 50 }}
      />
    </View>
  );
}
