// Config plugin: DNS-over-HTTPS for the Android OkHttp client that backs
// React Native's fetch.
//
// Why this exists: some ISPs block the anime source domains
// (anime4up / anime3rb / witanime) at the DNS layer — the classic "works on
// mobile data, but on home WiFi half the servers never show up". The block is
// just the ISP's resolver lying about those hostnames. We can't fix it from JS
// (RN's fetch can't override DNS) and we can't fix it with a server proxy
// (those sites reject datacenter IPs — Cloudflare challenge / nginx 403), so it
// has to be solved on the phone: resolve the blocked names over HTTPS and let
// OkHttp connect from the phone's own residential IP (which the sites accept).
// This is the direct mirror of the desktop app's configureHostResolver(DoH).
//
// Two mods:
//   1. drop a Kotlin file (PantoufaDoh.kt) with the DoH okhttp3.Dns + a
//      React Native OkHttpClientFactory into the app package, and
//   2. register that factory in MainApplication.onCreate so every fetch uses it.

const {
  withMainApplication,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const KOTLIN_SOURCE = (pkg) => `package ${pkg}

import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap

/**
 * DNS-over-HTTPS resolver for OkHttp. Some ISPs block the anime source domains
 * (anime4up / anime3rb / witanime) at the DNS layer — fine on mobile data, but
 * on those WiFi networks the system resolver returns NXDOMAIN (or a poisoned
 * IP), so half the servers never load. We resolve those names over HTTPS via
 * Cloudflare (reached by IP, 1.1.1.1, so the block can't touch the resolver
 * itself) and hand OkHttp the real IPs. OkHttp still uses the original hostname
 * for TLS SNI + cert validation and connects from the phone's residential IP,
 * which the sites accept — so this beats the block without breaking TLS.
 */
class PantoufaDohDns(private val system: Dns = Dns.SYSTEM) : Dns {
    private val client = OkHttpClient()
    private val cache = ConcurrentHashMap<String, List<InetAddress>>()

    // Known-blocked source hosts: resolve via DoH FIRST (also beats DNS
    // poisoning, where the system resolver answers with a bogus IP instead of
    // failing). Everything else uses the system resolver first and only falls
    // back to DoH if it fails — so normal traffic keeps its fast path.
    //
    // "vid3rb" covers anime3rb's first-party video host family
    // (video.vid3rb.com = the player page that carries the quality sources, and
    // files-N.vid3rb.com = the streaming CDN). These do NOT contain the string
    // "anime3rb", so without listing "vid3rb" explicitly they fell through to
    // the (poisoned) system resolver — anime3rb's title/episode pages resolved
    // fine over DoH but the player + CDN didn't, so NO Anime3rb server showed up
    // on blocking ISPs even though the rest of anime3rb worked.
    private val forceDoh = listOf("anime4up", "anime3rb", "witanime", "vid3rb")

    override fun lookup(hostname: String): List<InetAddress> {
        cache[hostname]?.let { return it }
        val prefer = forceDoh.any { hostname.contains(it, ignoreCase = true) }
        if (!prefer) {
            try {
                return system.lookup(hostname)
            } catch (_: Exception) {
                // system DNS failed (likely a block) — fall through to DoH
            }
        }
        val viaDoh = resolveDoh(hostname)
        if (viaDoh.isNotEmpty()) {
            cache[hostname] = viaDoh
            return viaDoh
        }
        return try {
            system.lookup(hostname)
        } catch (_: Exception) {
            throw UnknownHostException(hostname)
        }
    }

    private fun resolveDoh(hostname: String): List<InetAddress> {
        for (resolver in listOf("https://1.1.1.1/dns-query", "https://1.0.0.1/dns-query")) {
            try {
                val req = Request.Builder()
                    .url("$resolver?name=$hostname&type=A")
                    .header("accept", "application/dns-json")
                    .build()
                client.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) return@use
                    val body = resp.body?.string() ?: return@use
                    val answers = JSONObject(body).optJSONArray("Answer") ?: return@use
                    val ips = ArrayList<InetAddress>()
                    for (i in 0 until answers.length()) {
                        val ans = answers.getJSONObject(i)
                        if (ans.optInt("type") == 1) { // A record
                            val ip = ans.optString("data")
                            if (ip.isNotEmpty()) {
                                // Literal IP — getByName parses it, no recursion.
                                try { ips.add(InetAddress.getByName(ip)) } catch (_: Exception) {}
                            }
                        }
                    }
                    if (ips.isNotEmpty()) return ips
                }
            } catch (_: Exception) {
                // try the next resolver
            }
        }
        return emptyList()
    }
}

/** Builds RN's network client with the DoH resolver wired in. */
class PantoufaDohOkHttpClientFactory : OkHttpClientFactory {
    override fun createNewNetworkModuleClient(): OkHttpClient {
        return OkHttpClientProvider.createClientBuilder()
            .dns(PantoufaDohDns())
            .build()
    }
}
`;

function withDohKotlinSource(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const pkg = cfg.android?.package || "com.anime.mobile";
      const dir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...pkg.split(".")
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "PantoufaDoh.kt"), KOTLIN_SOURCE(pkg));
      return cfg;
    },
  ]);
}

function withDohRegistration(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;

    if (!src.includes("import com.facebook.react.modules.network.OkHttpClientProvider")) {
      src = src.replace(
        /(^package [^\n]+\n)/m,
        `$1\nimport com.facebook.react.modules.network.OkHttpClientProvider`
      );
    }

    if (!src.includes("PantoufaDohOkHttpClientFactory()")) {
      const call =
        "    OkHttpClientProvider.setOkHttpClientFactory(PantoufaDohOkHttpClientFactory())\n";
      if (/super\.onCreate\(\)\s*\n/.test(src)) {
        src = src.replace(/(super\.onCreate\(\)\s*\n)/, `$1${call}`);
      } else {
        // Fallback: insert at the start of onCreate's body.
        src = src.replace(
          /(override fun onCreate\(\)\s*\{\s*\n)/,
          `$1${call}`
        );
      }
    }

    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withAndroidDoH(config) {
  config = withDohKotlinSource(config);
  config = withDohRegistration(config);
  return config;
};
