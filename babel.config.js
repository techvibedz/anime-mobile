module.exports = function (api) {
  api.cache(true);
  return {
    // NativeWind's native wrapper drops Pressable style callbacks. Use React
    // for inline styles; className files opt into NativeWind with a JSX pragma.
    presets: ["babel-preset-expo"],
    plugins: ["react-native-worklets/plugin"],
  };
};
