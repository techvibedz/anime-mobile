import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image, type ImageLoadEventData, type ImageProps } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { M, MT, MANGA_FILL } from "../lib/manga/design";
import { t } from "../lib/i18n";
import { upgradeMangaPage } from "../lib/manga/cover";
import { useReducedMotion } from "../lib/motion";
import { MangaSkeleton } from "./MangaUI";

/** Shared recovery for every reader mode. A retry must bypass a failed cache entry. */
export function MangaPageImage({ uri, page, headers, contentFit, fullResolution = false, decodeSize, onMeasure, onDisplayed }: {
  uri: string;
  page: number;
  headers: Record<string, string>;
  contentFit: ImageProps["contentFit"];
  fullResolution?: boolean;
  decodeSize?: { width: number; height: number };
  onMeasure: (event: ImageLoadEventData) => void;
  onDisplayed: (uri: string) => void;
}) {
  const [src, setSrc] = useState(() => upgradeMangaPage(uri));
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayed = useRef(false);
  const reducedMotion = useReducedMotion();
  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    setSrc(upgradeMangaPage(uri));
    setAttempt(0);
    setStatus("loading");
    displayed.current = false;
  }, [uri]);

  const recover = useCallback(() => {
    clearTimer();
    if (displayed.current) return;
    if (src !== uri) {
      setSrc(uri);
      setAttempt((value) => value + 1);
    } else if (attempt < 2) {
      timer.current = setTimeout(() => setAttempt((value) => value + 1), 800);
    } else {
      setStatus("error");
    }
  }, [src, uri, attempt, clearTimer]);

  useEffect(() => {
    if (status === "loaded" || status === "error") return;
    displayed.current = false;
    timer.current = setTimeout(recover, 20_000);
    return clearTimer;
  }, [src, attempt, status, recover, clearTimer]);

  return (
    <View style={MANGA_FILL}>
      {status === "loading" && <MangaSkeleton dark style={MANGA_FILL} borderRadius={0} />}
      {status !== "error" && (
        <Image
          key={`${src}:${attempt}`}
          source={{ uri: src, headers, ...decodeSize, ...(attempt ? { cacheKey: `${src}|retry:${attempt}` } : {}) }}
          style={MANGA_FILL}
          contentFit={contentFit}
          cachePolicy={attempt ? "none" : decodeSize ? "memory-disk" : "disk"}
          recyclingKey={`${src}:${attempt}`}
          transition={decodeSize || reducedMotion ? 0 : 80}
          // Full-resolution zoom is only safe for ordinary scans. Long strips
          // use the platform's safe downsampling instead of enormous bitmaps.
          allowDownscaling={!fullResolution}
          accessibilityLabel={`الصفحة ${page + 1}`}
          // A re-request (e.g. the vertical box growing to the measured ratio)
          // keeps the current bitmap on screen until the sharper one arrives —
          // only the first load shows the skeleton.
          onLoadStart={() => { if (!displayed.current) setStatus("loading"); }}
          onLoad={onMeasure}
          onDisplay={() => {
            displayed.current = true;
            clearTimer();
            setStatus("loaded");
            onDisplayed(uri);
          }}
          onError={recover}
        />
      )}
      {status === "error" && (
        <View style={s.error}>
          <Ionicons name="cloud-offline-outline" size={28} color={M.nightAccent} />
          <Text style={s.label}>الصفحة {page + 1}</Text>
          <Text style={s.message}>{t.mangaPageError}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${t.retry} — الصفحة ${page + 1}`} style={s.retry}
            onPress={() => { setAttempt((value) => value + 1); setStatus("loading"); }}>
            <Ionicons name="refresh" size={18} color={M.white} />
            <Text style={s.retryText}>{t.retry}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  error: { ...MANGA_FILL, backgroundColor: M.night, alignItems: "center", justifyContent: "center", gap: 8, padding: 20 },
  label: { ...MT.heading, color: M.white },
  message: { ...MT.body, color: M.nightMuted, textAlign: "center" },
  retry: { minHeight: 48, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, marginTop: 8, backgroundColor: M.accent },
  retryText: { ...MT.label, color: M.white },
});
