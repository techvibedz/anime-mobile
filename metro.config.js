const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Evaluate each module on first use instead of all at launch (React Native's
// own template default). Cuts the boot-time module init that blocked the
// first frame; side-effect-only imports (`import "x"`) stay eager.
const getTransformOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async (...args) => {
  const opts = await getTransformOptions(...args);
  return { ...opts, transform: { ...opts.transform, inlineRequires: true } };
};

module.exports = withNativeWind(config, { input: "./global.css" });
