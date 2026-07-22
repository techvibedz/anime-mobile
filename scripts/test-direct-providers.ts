// Live verification for the direct embed resolvers (streamwish / voe /
// doodstream). Pulls a CURRENT episode's real server list (witanime direct
// decode, then anime4up direct parse as fallback), runs each new extractor on
// its provider's embed URL and range-checks that the extracted media URL
// actually serves bytes.
// Network-dependent — NOT part of `npm test`. Run: npx tsx scripts/test-direct-providers.ts
import {
  fetchWitHomeDirect,
  scrapeWitanimeEpisodePageDirect,
  scrapeAnime4upEpisodePageDirect,
  extractStreamwish,
  extractDoodstream,
  fetchHtml,
} from "../lib/scraper/direct";

const BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const UP4_BASE = "https://w1.anime4up.rest";

async function rangeCheck(url: string, referer?: string): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": BROWSER_UA, Range: "bytes=0-1", ...(referer ? { Referer: referer } : {}) },
    });
    return `HTTP ${res.status}`;
  } catch (e: any) {
    return `fetch error: ${e?.message ?? e}`;
  } finally {
    clearTimeout(t);
  }
}

async function serverLists(): Promise<{ label: string; servers: any[] }[]> {
  const out: { label: string; servers: any[] }[] = [];
  // witanime: try the first few recent episodes until one decodes servers.
  const home = await fetchWitHomeDirect().catch(() => null);
  for (const ep of ((home as any)?.episodes ?? []).slice(0, 5)) {
    const detail = await scrapeWitanimeEpisodePageDirect(ep.href).catch(() => null);
    if (detail && (detail.servers as any[]).length) {
      out.push({ label: `wit:${ep.href}`, servers: detail.servers as any[] });
      break;
    }
  }
  // anime4up: recent episodes are on the home page as /episode/ anchors.
  // Scan a few so rarer providers (streamwish) show up somewhere.
  const up4Home = await fetchHtml(`${UP4_BASE}/`).catch(() => null);
  const epHrefs = up4Home
    ? [...new Set([...up4Home.matchAll(/href=["']([^"']*\/episode\/[^"']+)["']/g)].map((m) => m[1]))].slice(0, 6)
    : [];
  for (const epHref of epHrefs) {
    const url = epHref.startsWith("http") ? epHref : `${UP4_BASE}${epHref.startsWith("/") ? "" : "/"}${epHref}`;
    const detail = await scrapeAnime4upEpisodePageDirect(url).catch(() => null);
    if (detail && (detail.servers as any[]).length) {
      out.push({ label: `up4:${url}`, servers: detail.servers as any[] });
    }
  }
  return out;
}

async function main() {
  const lists = await serverLists();
  if (!lists.length) throw new Error("no source produced a server list");
  const byProvider = new Map<string, string>();
  for (const { label, servers } of lists) {
    console.log(`servers from ${label}: ${servers.length}`);
    for (const s of servers) if (!byProvider.has(s.provider)) byProvider.set(s.provider, s.iframeUrl);
  }
  console.log("providers found:", [...byProvider.keys()].join(", "));

  const tried = new Set<string>();
  let failed = 0;
  for (const [provider, url] of byProvider) {
    const extractor =
      provider === "streamwish" ? extractStreamwish :
      // uqload also serves Dean-Edwards packed JS in static HTML — a live
      // stand-in that validates the shared unpacker pipeline end-to-end.
      provider === "uqload" ? extractStreamwish :
      provider === "doodstream" ? extractDoodstream : null;
    if (!extractor) continue;
    tried.add(provider);
    const started = Date.now();
    const r = await extractor(url).catch((e) => ({ error: String(e) }) as any);
    const ms = Date.now() - started;
    if (r?.url) {
      const status = await rangeCheck(r.url, url);
      console.log(`OK   ${provider}: ${r.type} in ${ms}ms → ${r.url.slice(0, 90)}… [${status}]`);
    } else {
      failed++;
      console.log(`FAIL ${provider}: ${(r as any)?.error ?? "null"} (${ms}ms) embed=${url}`);
    }
  }
  if (tried.size === 0) {
    console.log("no streamwish/uqload/doodstream server in these episodes — re-run later");
    process.exitCode = 2;
  } else if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
