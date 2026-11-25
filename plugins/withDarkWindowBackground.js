// Config plugin: paint the Android window background with the app's dark canvas.
//
// Why: AppTheme inherits Theme.AppCompat.DayNight, whose window background is
// WHITE on a light-mode phone. The Liquid Glass library captures the screen
// every frame; on pushed screens that left the content partly transparent and
// the white window bled through as a grey wash. A dark window also removes the
// white flash on cold start / between screens.
//
// NATIVE change — only takes effect in the next APK build.
const { withAndroidStyles, AndroidConfig } = require("expo/config-plugins");

module.exports = function withDarkWindowBackground(config) {
  return withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults;
    const appTheme = AndroidConfig.Styles.getAppThemeGroup();
    cfg.modResults = AndroidConfig.Styles.assignStylesValue(styles, {
      add: true,
      parent: appTheme,
      name: "android:windowBackground",
      value: "@color/splashscreen_background",
    });
    return cfg;
  });
};
