// expo-video creates its own OkHttpClient, bypassing the React Native client
// configured by PantoufaDohOkHttpClientFactory. Patch the installed Android
// source after every npm install so ExoPlayer and React Native fetch share the
// same DNS-over-HTTPS resolver and TLS policy.

const fs = require("node:fs");
const path = require("node:path");

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "expo-video",
  "android",
  "src",
  "main",
  "java",
  "expo",
  "modules",
  "video",
  "utils",
  "DataSourceUtils.kt",
);

if (!fs.existsSync(target)) {
  throw new Error(`expo-video Android source not found: ${target}`);
}

let source = fs.readFileSync(target, "utf8");
const oldImport = "import okhttp3.OkHttpClient";
const newImport = "import com.facebook.react.modules.network.OkHttpClientProvider";
const oldClient = "  val client = OkHttpClient.Builder().build()";
const newClient = "  val client = OkHttpClientProvider.getOkHttpClient().newBuilder().build()";

if (source.includes(newImport) && source.includes(newClient)) {
  process.stdout.write("expo-video DoH patch already applied.\n");
  process.exit(0);
}

if (!source.includes(oldImport) || !source.includes(oldClient)) {
  throw new Error("expo-video networking source changed; refusing an unsafe patch");
}

source = source.replace(oldImport, newImport).replace(oldClient, newClient);
fs.writeFileSync(target, source);
process.stdout.write("Applied expo-video shared DoH client patch.\n");
