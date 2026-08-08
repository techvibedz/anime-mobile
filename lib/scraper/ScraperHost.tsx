import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { _claimNext, _consumeCancelled, _hasPending, _peek, _resolve, _reject, _subscribe, ScrapeJob } from "./bus";
import { VIDEO_USER_AGENT } from "../videoProviders";
import { remoteLog } from "../remoteLog";
import {
  classifySourceFailure,
  clearSourcePreference,
  identifySource,
  isRetryableSourceStatus,
  markSourceHealthy,
  nextCandidateIndex,
} from "./sourceDomains";

// Number of concurrent WebView slots. Each slot can run one scrape job at a
// time. 4 lets the parallel video-server scrape (wit+up4 = 2 slots) run while
// two more slots resolve the first embeds, so playback begins sooner.
const SLOT_COUNT = 4;

import { WebView, WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest, WebViewProgressEvent } from "react-native-webview/lib/WebViewTypes";

// Anti-hijack guard for the hidden WebViews, injected before any page script.
// The episode/embed pages we scrape are ad-infested: programmatic clicks (the
// server-tab sweep, the play-button kicks) routinely trigger popunders, and
// with setSupportMultipleWindows={false} a window.open() ad loads IN THIS SAME
// WebView — replacing the page mid-scrape so the job spins until its timeout
// (a top "keeps loading, then fails" cause on slow connections, where the ad
// wins the race against the extractor). The visible embed WebView has had the
// same protection (ADBLOCK_JS in the watch screen); the hidden pool had none.
// Navigations the collector intentionally makes are flagged with
// window.__sjAllowNav (see COLLECT_VIDEO_AFTER) and always pass; known player
// hosts also pass so legit provider hops (voe mirrors, nested players) live.
const ANTI_HIJACK_JS = `(function(){
  window.open = function(){ return null; };
  window.alert = function(){}; window.confirm = function(){ return false; };
  var PLAYER_HOST = /videa|videakid|mp4upload|streamwish|hlswish|wishembed|wishfast|hgcloud|jwembed|voe|dood|ds2play|ds2video|d0o0d|do0od|vidply|all3do|doply|dsvplay|d-s\\.io|uqload|ok\\.ru|rubyvidhub|streamruby|rubystm|share4max|megamax|dailymotion|dai\\.ly|luluvdo|lulustream|yonaplay|vid3rb/i;
  function allowed(u){
    if (typeof u !== 'string') return true;
    if (!/^https?:/i.test(u)) return true;
    if (window.__sjAllowNav) return true;
    try {
      var h = new URL(u, location.href).hostname;
      return h === location.hostname || PLAYER_HOST.test(h);
    } catch (e) { return true; }
  }
  try {
    var _assign = location.assign.bind(location);
    var _replace = location.replace.bind(location);
    location.assign = function(u){ if (allowed(u)) _assign(u); };
    location.replace = function(u){ if (allowed(u)) _replace(u); };
    var d = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (d && d.set) {
      Object.defineProperty(Location.prototype, 'href', {
        get: d.get,
        set: function(u){ if (allowed(u)) d.set.call(location, u); },
      });
    }
  } catch (e) {}
  // Cross-origin ad anchors load in this same WebView when our click sweeps
  // hit them. preventDefault kills the navigation but deliberately does NOT
  // stopPropagation — the site's own click handlers (server-tab decoders)
  // must still run.
  document.addEventListener('click', function(e){
    try {
      var a = e.target && e.target.closest && e.target.closest('a');
      if (!a || !a.href || !/^https?:/i.test(a.href)) return;
      if (!allowed(a.href)) e.preventDefault();
    } catch (e2) {}
  }, true);
})();true;`;

// Main-frame navigations to known ad/tracker networks are blocked natively as
// well (covers target=_blank loads that bypass the JS guards). Server
// redirects and provider-mirror hops are NOT in this list and pass through.
const AD_HOST_RE =
  /(^|\.)(doubleclick\.net|googlesyndication\.com|google-analytics\.com|googletagmanager\.com|adservice\.google\.com|popads\.net|popcash\.net|pyppo\.[a-z.]+|exoclick\.com|juicyads\.com|trafficjunky\.(com|net)|adnxs\.com|outbrain\.com|taboola\.com|disqus\.com|adform\.net|hilltopads\.net|propellerads\.com|adcash\.com|revcontent\.com|mgid\.com|zergnet\.com|plugrush\.com|tsyndicate\.com|ero-advertising\.com|betweendigital\.com|facebook\.(com|net))$/i;

// Wrap the after-load script in a per-document, per-job guard so it runs at
// most ONCE per page: the early injection (see maybeInjectEarly below) and the
// automatic page-finish injection both deliver the same wrapped script, and
// whichever arrives second no-ops. The flag lives on `window`, so a navigation
// (redirect / player hop) gets a fresh document and the script runs again.
function wrapOnce(job: ScrapeJob): string {
  const key = `__sj_${job.id}`;
  return `(function(){try{if(window.${key})return true;window.${key}=1;}catch(e){}\n${job.injectAfter}\n})();true;`;
}

function ScraperSlot({
  job,
  onDone,
}: {
  job: ScrapeJob | null;
  onDone: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webRef = useRef<WebView | null>(null);
  const [attemptIndex, setAttemptIndex] = useState(0);
  const attemptIndexRef = useRef(0);
  const changingUrlRef = useRef(false);
  // URL the after-load script was last early-injected into. Reset on every
  // load start so reloads/redirects re-inject into the new document.
  const lastInjectedUrlRef = useRef<string | null>(null);

  const currentUrl = job?.urls[attemptIndex] || job?.url || "";

  useEffect(() => {
    attemptIndexRef.current = 0;
    changingUrlRef.current = false;
    setAttemptIndex(0);
  }, [job?.id]);

  useEffect(() => {
    if (!job) return;
    attemptIndexRef.current = attemptIndex;
    lastInjectedUrlRef.current = null;
    timerRef.current = setTimeout(() => {
      failAttempt(`scrape timeout after ${job.timeoutMs}ms`);
    }, job.timeoutMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [job?.id, attemptIndex]);

  function failAttempt(message: string, statusCode?: number, retry = true) {
    if (!job || changingUrlRef.current) return;
    const next = retry ? nextCandidateIndex(attemptIndexRef.current, job.urls.length) : null;
    if (next !== null) {
      changingUrlRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      void clearSourcePreference(currentUrl).catch(() => {});
      attemptIndexRef.current = next;
      lastInjectedUrlRef.current = null;
      setAttemptIndex(next);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    const source = identifySource(currentUrl);
    let hostname = "unknown";
    try { hostname = new URL(currentUrl).hostname; } catch {}
    void remoteLog("warn", "scraper", "source WebView failed", {
      source,
      hostname,
      failure: classifySourceFailure(message, statusCode),
      statusCode: statusCode || null,
    });
    _reject(job.id, message);
    onDone();
  }

  // react-native-webview only evaluates `injectedJavaScript` in onPageFinished
  // — i.e. after EVERY image, ad iframe and tracker on the source page has
  // downloaded. On a slow connection that alone can burn the entire job
  // timeout before the extractor even starts (this was the main "servers load
  // forever, then fail" cause). The extractors are all polling loops that only
  // need the DOM to exist, so inject the script as soon as the document's
  // first bytes arrive and let it wait for its own selectors. The automatic
  // page-finish injection stays as a fallback; wrapOnce dedupes the two.
  function maybeInjectEarly(e: WebViewProgressEvent) {
    if (!job) return;
    const { progress, url } = e.nativeEvent;
    if (progress < 0.08) return;
    const cur = url || currentUrl;
    if (lastInjectedUrlRef.current === cur) return;
    lastInjectedUrlRef.current = cur;
    webRef.current?.injectJavaScript(wrapOnce(job));
  }

  function handleMessage(e: WebViewMessageEvent) {
    if (!job) return;
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "result") {
        if (changingUrlRef.current) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        void markSourceHealthy(currentUrl).catch(() => {});
        _resolve(job.id, msg.data);
        onDone();
      } else if (msg.type === "error") {
        failAttempt(msg.message || "scrape error");
      }
      // ignore other types
    } catch {
      // ignore malformed
    }
  }

  // Block main-frame loads of ad/tracker networks that slip past the JS
  // guards (target=_blank popunders). Everything else — the initial page,
  // server redirects, provider-mirror hops — loads normally.
  function shouldStartLoad(req: ShouldStartLoadRequest): boolean {
    try {
      if (AD_HOST_RE.test(new URL(req.url).hostname)) return false;
    } catch { /* unparsable URL: let the WebView deal with it */ }
    return true;
  }

  if (!job) return null;
  return (
    <WebView
      ref={webRef}
      source={{ uri: currentUrl }}
      userAgent={VIDEO_USER_AGENT}
      javaScriptEnabled
      domStorageEnabled
      thirdPartyCookiesEnabled
      sharedCookiesEnabled
      cacheEnabled
      incognito={false}
      // Video jobs (they carry an injectBefore hook) need JS-initiated play():
      // the embed player must start so the fetch/XHR/video hook sees the real
      // media URL. Plain scrape jobs never need playback — blocking it stops
      // ad/preview videos on the source pages from autoplaying inside the
      // hidden WebView and stealing bandwidth from the scrape itself on slow
      // connections.
      mediaPlaybackRequiresUserAction={!job.injectBefore}
      allowsInlineMediaPlayback
      setSupportMultipleWindows={false}
      // Video-extraction jobs inject into ALL frames: some providers (videa
      // via vidvaita/vidit) nest the real player inside an iframe that the
      // main-frame script can't reach. Scrape jobs stay main-frame-only so a
      // stray ad iframe can't reject a job that the page itself would resolve.
      injectedJavaScriptForMainFrameOnly={!job.allFrames}
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly={!job.allFrames}
      injectedJavaScriptBeforeContentLoaded={ANTI_HIJACK_JS + (job.injectBefore || "")}
      injectedJavaScript={wrapOnce(job)}
      onShouldStartLoadWithRequest={shouldStartLoad}
      onLoadStart={(e) => {
        if (e.nativeEvent.url === currentUrl || e.nativeEvent.url.startsWith(currentUrl)) {
          changingUrlRef.current = false;
        }
        lastInjectedUrlRef.current = null;
      }}
      onLoadProgress={maybeInjectEarly}
      onMessage={handleMessage}
      onError={(e) => {
        failAttempt(`WebView error: ${e.nativeEvent.description}`);
      }}
      onHttpError={(e) => {
        // Cloudflare answers the FIRST main-frame request of a challenge
        // with 403/503 — the WebView then solves it and reloads on its own.
        // Rejecting on those codes kills jobs that would succeed seconds
        // later (this was why anime4up servers only appeared when CF
        // cookies were already warm). Let the injected _waitFor / the job
        // timeout decide instead. 429 is likewise transient.
        const sc = e.nativeEvent.statusCode;
        if (sc === 403 || sc === 503 || sc === 429) return;
        failAttempt(`HTTP ${sc}`, sc, isRetryableSourceStatus(sc));
      }}
      style={{ width: 1, height: 1 }}
    />
  );
}

// Hidden, off-screen WebView pool that processes scrape jobs in parallel.
// Render ONCE in the root layout.
export function ScraperHost() {
  const [slots, setSlots] = useState<(ScrapeJob | null)[]>(
    () => Array.from({ length: SLOT_COUNT }, () => null),
  );

  function fillSlots() {
    setSlots((prev) => {
      const next = [...prev];
      let changed = false;
      for (let i = 0; i < next.length; i++) {
        if (next[i] && _consumeCancelled(next[i]!.id)) {
          next[i] = null;
          changed = true;
        }
      }
      let bg = next.filter((j) => j && !j.priority).length;
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== null || !_hasPending()) continue;
        // Reserve one slot for user-facing (priority) video jobs. Background
        // pre-resolves may hold at most SLOT_COUNT-1 slots — otherwise, on a
        // slow connection, four in-flight background jobs (each up to a full
        // timeout) make a tapped server queue ~40s before it even starts,
        // which read as "servers keep loading forever". Priority only ordered
        // the QUEUE; it never freed an in-flight slot.
        const peeked = _peek();
        if (!peeked) break;
        if (!peeked.priority && bg >= SLOT_COUNT - 1) break;
        const claimed = _claimNext();
        if (claimed) {
          next[i] = claimed.job;
          if (!claimed.job.priority) bg++;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }

  function clearSlot(idx: number) {
    setSlots((prev) => {
      if (prev[idx] === null) return prev;
      const next = [...prev];
      next[idx] = null;
      return next;
    });
    // Try to start another job after this one ends
    setTimeout(fillSlots, 0);
  }

  useEffect(() => {
    const unsub = _subscribe(() => fillSlots());
    fillSlots();
    return unsub;
  }, []);

  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: -1000, top: -1000, width: SLOT_COUNT, height: 1, opacity: 0 }}
    >
      {slots.map((job, i) => (
        <ScraperSlot key={i} job={job} onDone={() => clearSlot(i)} />
      ))}
    </View>
  );
}
