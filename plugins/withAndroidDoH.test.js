const assert = require("node:assert/strict");
const plugin = require("./withAndroidDoH");

const dns = plugin.KOTLIN_SOURCE("com.anime.mobile");
const proxy = plugin.PROXY_KOTLIN_SOURCE("com.anime.mobile");

assert.match(dns, /data class CacheEntry/);
assert.match(dns, /expiresAt/);
assert.match(dns, /1\.1\.1\.1\/dns-query/);
assert.match(dns, /8\.8\.8\.8\/resolve/);
assert.match(dns, /callTimeout\(5, TimeUnit\.SECONDS\)/);
assert.match(dns, /DoH first for source, embed and final media CDN hosts/);
// Local/literal hosts must short-circuit BEFORE any DoH request: public
// resolvers answer NXDOMAIN for 127.0.0.1, and the two dead round-trips made
// the MEGA local stream unreachable inside the probe/player timeouts.
assert.match(dns, /if \(isLiteralHost\(hostname\)\) return listOf\(InetAddress\.getByName\(hostname\)\)/);
assert.match(dns, /private fun isLiteralHost\(hostname: String\): Boolean/);
assert.match(dns, /host\.equals\("localhost", ignoreCase = true\)/);
assert.match(dns, /host\.contains\(':'\)/);
assert.ok(
  dns.indexOf("isLiteralHost(hostname)") < dns.indexOf("resolveDoh(hostname)"),
  "the literal short-circuit must run before the DoH lookup",
);
assert.doesNotMatch(dns, /forceDoh|val prefer/);
assert.match(proxy, /for \(addr in addresses\)/);
assert.doesNotMatch(dns, /hostnameVerifier|trustAll|X509TrustManager/);

console.log("withAndroidDoH tests passed");
