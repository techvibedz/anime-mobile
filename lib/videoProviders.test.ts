import assert from "node:assert";
import {
  classifyProvider,
  classifyProviderWithName,
  createGenerationGuard,
  anime4upEpisodeUrl,
  episodeNumberFromUrl,
  selectServerCandidates,
  serverCandidateSignature,
  isDirectProvider,
  isProviderSupported,
  mergeVideoServers,
  normalizeServerUrl,
  probeMediaUrl,
  providerClassifierScript,
  providerFailureMode,
  preferredAnime4upEpisodeUrl,
  selectWarmupServers,
  sortVideoServers,
  validateDirectServers,
  validateMediaUrl,
} from "./videoProviders";

let passed = 0;
let failed = 0;
const pending: Promise<void>[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  pending.push(Promise.resolve().then(fn).then(() => {
    passed++;
    console.log(`  ok  ${name}`);
  }, (error: any) => {
    failed++;
    console.error(`FAIL  ${name}\n      ${error?.message || error}`);
  }));
}

test("classifies every provider currently returned by live source pages", () => {
  const cases: Record<string, string> = {
    "https://www.mp4upload.com/embed-abc.html": "mp4upload",
    "https://geo.dailymotion.com/player.html?video=x": "dailymotion",
    "https://hgcloud.to/e/abc": "streamwish",
    "https://voe.sx/e/abc": "voe",
    "https://share4max.com/e/abc": "share4max",
    "https://rubyvidhub.com/embed-abc": "streamruby",
    "https://dsvplay.com/e/abc": "doodstream",
    "https://uqload.is/embed-abc.html": "uqload",
    "https://ok.ru/videoembed/1": "okru",
    "https://app.videas.fr/embed/media/1": "videas",
    "https://videa.hu/player?v=1": "videa",
    "https://vk.com/video_ext.php?id=1": "vk",
    "https://video.vid3rb.com/player/abc": "vid3rb",
    "https://luluvdo.com/e/abc": "luluvdo",
    "https://yonaplay.net/embed.php?id=1": "yonaplay",
  };
  for (const [url, expected] of Object.entries(cases)) {
    assert.equal(classifyProvider(url), expected, url);
  }
  assert.equal(classifyProvider("https://new-player.example/e/1"), "generic");
});

test("the injected classifier uses the same provider rules", () => {
  const classify = new Function(
    "url",
    `${providerClassifierScript("provider")} return provider(url);`,
  ) as (url: string) => string;
  assert.equal(classify("https://app.videas.fr/embed/media/1"), "videas");
  assert.equal(classify("https://dsvplay.com/e/abc"), "doodstream");
  assert.equal(classify("https://new-player.example/e/1"), "generic");
});

test("keeps only non-native providers on visible WebView fallback", () => {
  for (const provider of ["vk", "mega", "generic"]) {
    assert.equal(isProviderSupported(provider), true, provider);
    assert.equal(providerFailureMode(provider), "webview", provider);
  }
  for (const provider of ["voe", "okru", "uqload", "share4max", "streamruby"]) {
    assert.equal(providerFailureMode(provider), "failed", provider);
  }
  assert.equal(isProviderSupported("yonaplay"), false);
  assert.equal(providerFailureMode("mp4upload"), "failed");
});

test("direct picker includes native extractors and hides WebView-only providers", () => {
  for (const provider of ["vid3rb", "mp4upload", "streamwish", "videas", "doodstream", "dailymotion", "voe", "uqload", "okru", "videa"]) {
    assert.equal(isDirectProvider(provider), true, provider);
  }
  for (const provider of ["generic", "yonaplay", "vk", "mega"]) {
    assert.equal(isDirectProvider(provider), false, provider);
  }
});

test("episode number is recovered from source URL shapes", () => {
  assert.equal(episodeNumberFromUrl("https://witanime.you/episode/title-الحلقة-12/"), 12);
  assert.equal(episodeNumberFromUrl("https://anime3rb.com/episode/title/7"), 7);
  assert.equal(episodeNumberFromUrl("https://example.com/no-number"), null);
});

test("discovered native candidates are immediately selectable", () => {
  const candidates = selectServerCandidates([
    { provider: "mp4upload", iframeUrl: "https://mp4upload.com/e/1" },
    { provider: "generic", iframeUrl: "https://example.com/e/1" },
  ]);
  assert.deepEqual(candidates, [{ provider: "mp4upload", iframeUrl: "https://mp4upload.com/e/1" }]);
});

test("candidate signatures ignore object identity but detect new servers", () => {
  const first = [{ provider: "mp4upload", iframeUrl: "https://mp4upload.com/e/1", source: "anime4up" }];
  assert.equal(serverCandidateSignature(first), serverCandidateSignature(first.map((server) => ({ ...server }))));
  assert.notEqual(serverCandidateSignature(first), serverCandidateSignature([...first, { provider: "voe", iframeUrl: "https://voe.sx/e/2", source: "anime4up" }]));
});

test("recognizes current Anime4up private and redirected server names", () => {
  assert.equal(classifyProviderWithName("https://4o.z4m2r9t.shop/Anime4up-S1/mal/35120/8/sub/", "anime4up1 [FHD]"), "anime4upcdn");
  assert.equal(classifyProviderWithName("https://playmogo.com/e/t0rdyelb0krl", "DoodStream [FHD]"), "doodstream");
});

test("builds the current Anime4up episode URL without a title search", () => {
  assert.equal(
    anime4upEpisodeUrl("Devilman: Crybaby", 8),
    "https://w1.anime4up.rest/episode/انمي-devilman-crybaby-الحلقة-8-مترجمة/",
  );
});

test("exact harvested Anime4up episode URL wins over title search", () => {
  assert.equal(preferredAnime4upEpisodeUrl(null, "https://anime4up.rest/episode/exact"), "https://anime4up.rest/episode/exact");
  assert.equal(preferredAnime4upEpisodeUrl("https://anime4up.rest/episode/passed", "https://anime4up.rest/episode/exact"), "https://anime4up.rest/episode/passed");
});

test("normalizes equivalent embeds without collapsing vid3rb qualities", () => {
  assert.equal(
    normalizeServerUrl("https://Example.com/embed/abc/"),
    normalizeServerUrl("https://example.com/embed/abc"),
  );
  assert.notEqual(
    normalizeServerUrl("https://video.vid3rb.com/player/abc#vid3rb=1080"),
    normalizeServerUrl("https://video.vid3rb.com/player/abc#vid3rb=720"),
  );
});

test("sorts by provider reliability then quality", () => {
  const sorted = sortVideoServers([
    { name: "Voe 1080p", provider: "voe", iframeUrl: "https://voe.sx/e/1" },
    { name: "Mp4upload 480p", provider: "mp4upload", iframeUrl: "https://mp4upload.com/e/1" },
    { name: "Anime3rb 720p", provider: "vid3rb", iframeUrl: "https://video.vid3rb.com/player/1#vid3rb=720" },
    { name: "Anime3rb 1080p", provider: "vid3rb", iframeUrl: "https://video.vid3rb.com/player/1#vid3rb=1080" },
  ]);
  assert.deepEqual(sorted.map((s) => s.name), [
    "Anime3rb 1080p",
    "Anime3rb 720p",
    "Mp4upload 480p",
    "Voe 1080p",
  ]);
});

test("warmup validates only the three best native candidates", () => {
  const warmup = selectWarmupServers([
    { name: "Generic", provider: "generic", iframeUrl: "https://example.com/e/1" },
    { name: "Voe", provider: "voe", iframeUrl: "https://voe.sx/e/1" },
    { name: "MP4", provider: "mp4upload", iframeUrl: "https://mp4upload.com/e/1" },
    { name: "Wish", provider: "streamwish", iframeUrl: "https://hgcloud.to/e/1" },
    { name: "Anime3rb", provider: "vid3rb", iframeUrl: "https://vid3rb.com/player/1" },
  ]);
  assert.deepEqual(warmup.map((server) => server.provider), ["vid3rb", "mp4upload", "streamwish"]);
});

test("merges all usable providers and deduplicates equivalent embeds", () => {
  const merged = mergeVideoServers([
    [
      { id: "a", name: "Unknown", provider: "generic", iframeUrl: "https://new.example/e/1/", source: "witanime" },
      { id: "b", name: "Voe", provider: "voe", iframeUrl: "https://voe.sx/e/2", source: "witanime" },
    ],
    [
      { id: "c", name: "Duplicate", provider: "generic", iframeUrl: "https://new.example/e/1#tracking", source: "anime4up" },
      { id: "d", name: "Blocked", provider: "yonaplay", iframeUrl: "https://yonaplay.net/embed.php?id=1", source: "anime4up" },
    ],
  ]);
  assert.deepEqual(merged.map((server) => server.provider).sort(), ["generic", "voe"]);
  assert.equal(merged.filter((server) => server.provider === "generic").length, 1);
});

test("rejects decoys and provider-invalid media URLs", () => {
  assert.equal(validateMediaUrl("https://cdn.example/master.m3u8?token=1", "streamwish"), true);
  assert.equal(validateMediaUrl("https://s14.mp4upload.com/d/video.mp4?token=1", "mp4upload"), true);
  assert.equal(validateMediaUrl("https://example.com/video.mp4", "mp4upload"), false);
  assert.equal(validateMediaUrl("https://cdn.dood.example/stream/abc?token=x&expiry=1", "doodstream"), true);
  assert.equal(validateMediaUrl("https://proxy-1.dailymotion.com/sec/video", "dailymotion"), true);
  assert.equal(validateMediaUrl("https://cdn.example/sample-video.mp4", "generic"), false);
  assert.equal(validateMediaUrl("https://streamwish.to/embed-video.mp4", "streamwish"), false);
});

test("rejects completions from an older episode generation", () => {
  const guard = createGenerationGuard();
  const oldEpisode = guard.next();
  const currentEpisode = guard.next();
  assert.equal(guard.isCurrent(oldEpisode), false);
  assert.equal(guard.isCurrent(currentEpisode), true);
});

test("direct picker keeps only servers with provider-valid resolved media", async () => {
  const servers = [
    { id: "a", name: "MP4Upload", provider: "mp4upload", iframeUrl: "https://www.mp4upload.com/embed-a.html" },
    { id: "b", name: "Voe", provider: "voe", iframeUrl: "https://voe.sx/e/b" },
    { id: "c", name: "Broken", provider: "streamwish", iframeUrl: "https://streamwish.to/e/c" },
  ];
  const resolved = await validateDirectServers(servers, async (server) =>
    server.provider === "mp4upload"
      ? "https://s14.mp4upload.com/d/a/video.mp4?token=1"
      : server.provider === "streamwish"
        ? "https://streamwish.to/embed-c.mp4"
        : null,
  );
  assert.deepEqual(resolved.map((server) => server.provider), ["mp4upload"]);
  assert.equal(resolved[0].videoUrl, "https://s14.mp4upload.com/d/a/video.mp4?token=1");
});

test("direct validation reports each newly playable server cumulatively", async () => {
  const servers = [
    { id: "a", name: "A", provider: "streamwish", iframeUrl: "https://streamwish.to/e/a" },
    { id: "b", name: "B", provider: "mp4upload", iframeUrl: "https://www.mp4upload.com/embed-b.html" },
  ];
  const updates: string[][] = [];
  await validateDirectServers(
    servers,
    async (server) => server.provider === "streamwish"
      ? "https://cdn.example.com/a.m3u8"
      : "https://s14.mp4upload.com/d/b/video.mp4",
    (playable) => updates.push(playable.map((server) => server.provider)),
  );
  assert.deepEqual(updates, [["streamwish"], ["streamwish", "mp4upload"]]);
});

test("media probe accepts reachable bytes and rejects HTTP failures", async () => {
  assert.equal(await probeMediaUrl("https://cdn.example.com/video.mp4", {}, async () => ({ ok: true, status: 206 })), true);
  assert.equal(await probeMediaUrl("https://cdn.example.com/video.mp4", {}, async () => ({ ok: false, status: 403 })), false);
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
