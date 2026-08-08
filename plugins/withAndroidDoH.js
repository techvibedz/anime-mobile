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
//
// Plus a second pair for the WEBVIEW (added later):
//   3. drop PantoufaDohProxy.kt — a tiny localhost forward proxy that resolves
//      CONNECT targets via the same DoH resolver and tunnels the TLS bytes, and
//   4. point every WebView at it via ProxyController.setProxyOverride. Chromium
//      resolves with the SYSTEM resolver, so without this the hidden scraper
//      WebView (and video-embed extraction) still fail on DNS-poisoning ISPs
//      even though plain fetch works.

const {
  withMainApplication,
  withDangerousMod,
  withAppBuildGradle,
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
    private data class CacheEntry(val addresses: List<InetAddress>, val expiresAt: Long)
    private data class DohResult(val addresses: List<InetAddress>, val ttlMs: Long)
    private val cache = ConcurrentHashMap<String, CacheEntry>()

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
        val now = System.currentTimeMillis()
        cache[hostname]?.let {
            if (it.expiresAt > now) return it.addresses
            cache.remove(hostname, it)
        }
        val prefer = forceDoh.any { hostname.contains(it, ignoreCase = true) }
        if (!prefer) {
            try {
                return system.lookup(hostname)
            } catch (_: Exception) {
                // system DNS failed (likely a block) — fall through to DoH
            }
        }
        val viaDoh = resolveDoh(hostname)
        if (viaDoh != null) {
            cache[hostname] = CacheEntry(viaDoh.addresses, now + viaDoh.ttlMs)
            return viaDoh.addresses
        }
        return try {
            system.lookup(hostname)
        } catch (_: Exception) {
            throw UnknownHostException(hostname)
        }
    }

    private fun resolveDoh(hostname: String): DohResult? {
        for (resolver in listOf("https://1.1.1.1/dns-query", "https://8.8.8.8/resolve")) {
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
                    var ttlSeconds = 600L
                    for (i in 0 until answers.length()) {
                        val ans = answers.getJSONObject(i)
                        if (ans.optInt("type") == 1) { // A record
                            val ip = ans.optString("data")
                            parseIpv4(ip)?.let { ips.add(it) }
                            ttlSeconds = minOf(ttlSeconds, ans.optLong("TTL", 60L))
                        }
                    }
                    if (ips.isNotEmpty()) {
                        val ttlMs = ttlSeconds.coerceIn(30L, 600L) * 1000L
                        return DohResult(ips.distinct(), ttlMs)
                    }
                }
            } catch (_: Exception) {
                // try the next resolver
            }
        }
        return null
    }

    private fun parseIpv4(ip: String): InetAddress? {
        val parts = ip.split(".")
        if (parts.size != 4) return null
        val octets = parts.map { it.toIntOrNull() ?: return null }
        if (octets.any { it !in 0..255 }) return null
        return InetAddress.getByAddress(octets.map { it.toByte() }.toByteArray())
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

// NOTE: written without Kotlin string templates ($) so the JS template literal
// below needs no escaping — keep it that way.
const PROXY_KOTLIN_SOURCE = (pkg) => `package ${pkg}

import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.util.concurrent.Executors

/**
 * Tiny localhost forward proxy that routes WebView traffic through DoH-based
 * DNS. Android's WebView (Chromium) resolves hostnames with the SYSTEM
 * resolver — RN's OkHttp DoH factory (PantoufaDohDns) can't touch it — so on
 * ISPs that poison the anime source domains the hidden scraper WebView (and
 * video-embed extraction) fail even though plain fetch works.
 *
 * Fix: point every WebView at this proxy (ProxyController.setProxyOverride,
 * registered in MainApplication). Chromium then asks us to CONNECT host:443;
 * WE resolve the host — via PantoufaDohDns, so DoH-first for the known-blocked
 * sources and system-first-with-DoH-fallback for the rest — and tunnel the raw
 * TLS bytes to the real IP. TLS stays end-to-end (SNI + cert validation use
 * the original hostname) and cookies behave exactly as before, because the
 * proxy never terminates TLS.
 *
 * Bound to 127.0.0.1 only — no other app can reach it. If it fails to start,
 * the proxy override is simply never installed and the WebView keeps system
 * DNS (the pre-fix behavior), so this can never regress working users.
 */
object PantoufaDohProxy {
    private const val TAG = "PantoufaDohProxy"
    private val dns = PantoufaDohDns()
    private val pool = Executors.newCachedThreadPool()
    @Volatile var port: Int = 0
        private set
    @Volatile private var started = false

    @Synchronized
    fun start(): Int {
        if (started) return port
        started = true
        try {
            val server = ServerSocket(0, 64, InetAddress.getByName("127.0.0.1"))
            port = server.localPort
            pool.execute {
                while (!server.isClosed) {
                    try {
                        val client = server.accept()
                        pool.execute { runCatching { handle(client) } }
                    } catch (_: Exception) {
                        // Keep accepting — a single bad connection must not
                        // kill the proxy loop.
                    }
                }
            }
            Log.i(TAG, "DoH proxy listening on 127.0.0.1:" + port)
        } catch (e: Exception) {
            Log.w(TAG, "proxy failed to start — WebView keeps system DNS", e)
            port = 0
        }
        return port
    }

    private fun handle(client: Socket) {
        client.soTimeout = 30000
        val input = client.getInputStream()
        // Read the request line + headers (bounded — CONNECT headers are tiny).
        val headerBytes = readHeaders(input)
        if (headerBytes == null) { closeQuietly(client); return }
        val header = String(headerBytes, Charsets.ISO_8859_1)
        val requestLine = header.substringBefore("\\r\\n")
        val parts = requestLine.split(" ")
        if (parts.size < 2) { closeQuietly(client); return }

        val hostPort: String
        var prefix = ByteArray(0)
        if (parts[0].equals("CONNECT", ignoreCase = true)) {
            hostPort = parts[1]
        } else {
            // Plain HTTP (absolute-URI form). All scrape targets are https, but
            // forward these too so nothing inside a page ever breaks.
            val uri = try { URI(parts[1]) } catch (_: Exception) { closeQuietly(client); return }
            val h = uri.host
            if (h.isNullOrEmpty()) { closeQuietly(client); return }
            hostPort = if (uri.port > 0) h + ":" + uri.port else h + ":80"
            // Re-send the request in origin form (path + query), not absolute.
            var originForm = uri.rawPath ?: "/"
            if (uri.rawQuery != null) originForm += "?" + uri.rawQuery
            val newLine = parts[0] + " " + originForm + " HTTP/1.1"
            prefix = (newLine + header.substring(requestLine.length)).toByteArray(Charsets.ISO_8859_1)
        }

        val host = hostPort.substringBeforeLast(":")
        val portNum = hostPort.substringAfterLast(":").toIntOrNull() ?: 443

        val upstream = connect(host, portNum)
        if (upstream == null) { closeQuietly(client); return }

        if (prefix.isEmpty()) {
            // CONNECT: acknowledge, then become a pure byte tunnel.
            val out = client.getOutputStream()
            out.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n".toByteArray(Charsets.ISO_8859_1))
            out.flush()
        } else {
            val out = upstream.getOutputStream()
            out.write(prefix)
            out.flush()
        }
        client.soTimeout = 0

        pool.execute { pipe(client, upstream) }  // client → upstream
        pool.execute { pipe(upstream, client) }  // upstream → client
    }

    private fun connect(host: String, port: Int): Socket? {
        val addresses = runCatching { dns.lookup(host) }.getOrNull() ?: return null
        for (addr in addresses) {
            val socket = Socket()
            try {
                socket.connect(InetSocketAddress(addr, port), 10000)
                // Long-lived tunnel: Chromium closes idle connections itself.
                socket.soTimeout = 0
                socket.tcpNoDelay = true
                return socket
            } catch (_: Exception) {
                closeQuietly(socket)
            }
        }
        return null
    }

    // Read until CRLFCRLF, capped at 16 KiB — CONNECT headers never get close.
    private fun readHeaders(input: InputStream): ByteArray? {
        val buf = ByteArrayOutputStream()
        var matched = 0
        val end = byteArrayOf(13, 10, 13, 10)
        while (buf.size() < 16384) {
            val b = input.read()
            if (b < 0) return null
            buf.write(b)
            matched = if (b.toByte() == end[matched]) matched + 1
                      else if (b.toByte() == end[0]) 1
                      else 0
            if (matched == 4) return buf.toByteArray()
        }
        return null
    }

    // Pump bytes src → dst until EOF, then close BOTH sockets: the peer pipe
    // sees EOF and exits, freeing its thread. HTTPS over CONNECT never relies
    // on half-closes, so a full close on first EOF is safe.
    private fun pipe(src: Socket, dst: Socket) {
        try {
            val buf = ByteArray(64 * 1024)
            val input = src.getInputStream()
            val output = dst.getOutputStream()
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                output.write(buf, 0, n)
                output.flush()
            }
        } catch (_: Exception) {
        } finally {
            closeQuietly(src)
            closeQuietly(dst)
        }
    }

    private fun closeQuietly(s: Socket) {
        try { s.close() } catch (_: Exception) {}
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
      fs.writeFileSync(path.join(dir, "PantoufaDohProxy.kt"), PROXY_KOTLIN_SOURCE(pkg));
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

    // WebView half of the fix: start the localhost DoH proxy and point every
    // WebView at it. Guarded by the androidx.webkit feature check — on a
    // WebView too old for PROXY_OVERRIDE nothing changes (system DNS, the
    // pre-fix behavior). If the proxy fails to bind, port is 0 and the
    // override is skipped for the same reason.
    if (!src.includes("PantoufaDohProxy.start()")) {
      const proxyCall =
        "    val pantoufaDohProxyPort = PantoufaDohProxy.start()\n" +
        "    if (pantoufaDohProxyPort > 0 && androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.PROXY_OVERRIDE)) {\n" +
        "      androidx.webkit.ProxyController.getInstance().setProxyOverride(\n" +
        "        androidx.webkit.ProxyConfig.Builder().addProxyRule(\"127.0.0.1:\" + pantoufaDohProxyPort).build(),\n" +
        "        java.util.concurrent.Executors.newSingleThreadExecutor()\n" +
        "      ) { }\n" +
        "    }\n";
      if (/super\.onCreate\(\)\s*\n/.test(src)) {
        src = src.replace(/(super\.onCreate\(\)\s*\n)/, `$1${proxyCall}`);
      } else {
        src = src.replace(
          /(override fun onCreate\(\)\s*\{\s*\n)/,
          `$1${proxyCall}`
        );
      }
    }

    cfg.modResults.contents = src;
    return cfg;
  });
}

function withAndroidDoH(config) {
  config = withDohKotlinSource(config);
  config = withDohRegistration(config);
  config = withWebkitDependency(config);
  return config;
}

module.exports = withAndroidDoH;
module.exports.KOTLIN_SOURCE = KOTLIN_SOURCE;
module.exports.PROXY_KOTLIN_SOURCE = PROXY_KOTLIN_SOURCE;

// react-native-webview pulls androidx.webkit as `implementation`, which keeps
// it OFF the app module's compile classpath — MainApplication's ProxyController
// references would fail with "unresolved reference: webkit". Declare it here.
function withWebkitDependency(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === "groovy" && !cfg.modResults.contents.includes("androidx.webkit:webkit")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        (m) => `${m}\n    // WebView proxy override (DoH) — see PantoufaDohProxy.kt\n    implementation("androidx.webkit:webkit:1.14.0")`
      );
    }
    return cfg;
  });
}
