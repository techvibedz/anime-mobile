import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { _claimNext, _hasPending, _resolve, _reject, _subscribe, ScrapeJob } from "./bus";

// Number of concurrent WebView slots. Each slot can run one scrape job at a
// time. 4 lets the parallel video-server scrape (wit+up4 = 2 slots) run while
// two more slots resolve the first embeds, so playback begins sooner.
const SLOT_COUNT = 4;

import { WebView, WebViewMessageEvent } from "react-native-webview";

function ScraperSlot({
  job,
  onDone,
}: {
  job: ScrapeJob | null;
  onDone: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!job) return;
    timerRef.current = setTimeout(() => {
      _reject(job.id, `scrape timeout after ${job.timeoutMs}ms`);
      onDone();
    }, job.timeoutMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [job?.id]);

  function handleMessage(e: WebViewMessageEvent) {
    if (!job) return;
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "result") {
        if (timerRef.current) clearTimeout(timerRef.current);
        _resolve(job.id, msg.data);
        onDone();
      } else if (msg.type === "error") {
        if (timerRef.current) clearTimeout(timerRef.current);
        _reject(job.id, msg.message || "scrape error");
        onDone();
      }
      // ignore other types
    } catch {
      // ignore malformed
    }
  }

  if (!job) return null;
  return (
    <WebView
      source={{ uri: job.url }}
      userAgent="Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
      javaScriptEnabled
      domStorageEnabled
      thirdPartyCookiesEnabled
      sharedCookiesEnabled
      cacheEnabled
      incognito={false}
      // Without this, Android WebView blocks JS-initiated play() — the embed
      // player never starts, so the fetch/XHR/video hook never sees the real
      // media URL (videa & mp4upload resolve via that hook).
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      setSupportMultipleWindows={false}
      // Video-extraction jobs inject into ALL frames: some providers (videa
      // via vidvaita/vidit) nest the real player inside an iframe that the
      // main-frame script can't reach. Scrape jobs stay main-frame-only so a
      // stray ad iframe can't reject a job that the page itself would resolve.
      injectedJavaScriptForMainFrameOnly={!job.allFrames}
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly={!job.allFrames}
      injectedJavaScriptBeforeContentLoaded={job.injectBefore}
      injectedJavaScript={job.injectAfter}
      onMessage={handleMessage}
      onError={(e) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        _reject(job.id, `WebView error: ${e.nativeEvent.description}`);
        onDone();
      }}
      onHttpError={(e) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        _reject(job.id, `HTTP ${e.nativeEvent.statusCode}`);
        onDone();
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
        if (next[i] === null && _hasPending()) {
          const claimed = _claimNext();
          if (claimed) { next[i] = claimed.job; changed = true; }
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
