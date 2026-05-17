import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { _peek, _subscribe, _resolveCurrent, _rejectCurrent, ScrapeJob } from "./bus";

// Hidden WebView that processes scrape jobs one at a time.
// Render this ONCE in the root layout. Off-screen (1×1 px at -1000,-1000).
export function ScraperHost() {
  const [current, setCurrent] = useState<ScrapeJob | null>(null);
  const webRef = useRef<WebView | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function tryStartNext() {
    if (current) return;
    const next = _peek();
    if (next) {
      setCurrent(next.job);
      timerRef.current && clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        _rejectCurrent(next.job.id, `scrape timeout after ${next.job.timeoutMs}ms`);
        setCurrent(null);
      }, next.job.timeoutMs);
    }
  }

  useEffect(() => {
    const unsub = _subscribe(() => tryStartNext());
    tryStartNext();
    return () => {
      unsub();
      timerRef.current && clearTimeout(timerRef.current);
    };
  }, []);

  // When a job finishes (success or failure), try to start the next one.
  useEffect(() => {
    if (!current) tryStartNext();
  }, [current]);

  function handleMessage(e: WebViewMessageEvent) {
    if (!current) return;
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "result") {
        timerRef.current && clearTimeout(timerRef.current);
        _resolveCurrent(current.id, msg.data);
        setCurrent(null);
      } else if (msg.type === "error") {
        timerRef.current && clearTimeout(timerRef.current);
        _rejectCurrent(current.id, msg.message || "scrape error");
        setCurrent(null);
      }
      // other types (debug, partial) are ignored
    } catch {
      // ignore malformed messages
    }
  }

  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: -1000, top: -1000, width: 1, height: 1, opacity: 0 }}
    >
      {current ? (
        <WebView
          ref={webRef}
          source={{ uri: current.url }}
          // Standard desktop UA helps with sites that gate mobile UAs.
          userAgent="Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          cacheEnabled
          incognito={false}
          injectedJavaScriptBeforeContentLoaded={current.injectBefore}
          injectedJavaScript={current.injectAfter}
          onMessage={handleMessage}
          onError={(e) => {
            _rejectCurrent(current.id, `WebView error: ${e.nativeEvent.description}`);
            setCurrent(null);
          }}
          onHttpError={(e) => {
            _rejectCurrent(current.id, `HTTP ${e.nativeEvent.statusCode}`);
            setCurrent(null);
          }}
          style={{ width: 1, height: 1 }}
        />
      ) : null}
    </View>
  );
}
