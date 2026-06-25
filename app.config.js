// Pure passthrough of app.json, with ONE knob: OTA_RUNTIME lets `eas update`
// target a specific (legacy) runtimeVersion without editing app.json. When the
// env var is unset — i.e. every build and every normal publish — the static
// fingerprint policy from app.json is used unchanged, so build behavior is
// identical to having no dynamic config at all. Used by scripts/publish-ota.sh
// to reach installs stranded on old string runtimes. See
// [[ota-delivery-runtime-and-apply]].
module.exports = ({ config }) => ({
  ...config,
  runtimeVersion: process.env.OTA_RUNTIME || config.runtimeVersion,
});
