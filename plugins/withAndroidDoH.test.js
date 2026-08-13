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
assert.doesNotMatch(dns, /forceDoh|val prefer/);
assert.match(proxy, /for \(addr in addresses\)/);
assert.doesNotMatch(dns, /hostnameVerifier|trustAll|X509TrustManager/);

console.log("withAndroidDoH tests passed");
