// Config plugin: raise the Android AsyncStorage SQLite cap.
//
// Why this exists: @react-native-async-storage/async-storage defaults to a
// 6 MB database on Android unless `AsyncStorage_db_size_in_MB` is set in
// android/gradle.properties. This app caches a lot in AsyncStorage (catalog,
// schedule, anime metadata, server lists, translations…). Once that DB fills,
// EVERY write fails — and the failure is swallowed by callers — so watch
// history, Continue Watching dismissals and the downloads index silently stop
// persisting ("my progress isn't saved", "the X doesn't stick").
//
// The JS layer now prunes re-fetchable caches and retries, but the DB should
// not be 6 MB in the first place. 50 MB matches what a video app with offline
// metadata realistically needs.
//
// NOTE: this is a NATIVE change — it only takes effect in the next APK build
// (the JS pruning covers existing installs via OTA).
const { withGradleProperties } = require("expo/config-plugins");

const DB_SIZE_MB = "50";

module.exports = function withAsyncStorageSize(config) {
  return withGradleProperties(config, (cfg) => {
    const key = "AsyncStorage_db_size_in_MB";
    const props = cfg.modResults;
    const existing = props.find((p) => p.type === "property" && p.key === key);
    if (existing) existing.value = DB_SIZE_MB;
    else props.push({ type: "property", key, value: DB_SIZE_MB });
    return cfg;
  });
};
