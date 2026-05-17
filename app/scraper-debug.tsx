import { useState } from "react";
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { scrapeWitanimeHome, extractVideoUrl } from "../lib/scraper";
import { C } from "../lib/theme";

export default function ScraperDebug() {
  const insets = useSafeAreaInsets();
  const [homeStatus, setHomeStatus] = useState<"idle" | "running" | "ok" | "err">("idle");
  const [homeResult, setHomeResult] = useState<string>("");
  const [homeMs, setHomeMs] = useState<number | null>(null);

  const [embedUrl, setEmbedUrl] = useState("");
  const [videoStatus, setVideoStatus] = useState<"idle" | "running" | "ok" | "err">("idle");
  const [videoResult, setVideoResult] = useState<string>("");
  const [videoMs, setVideoMs] = useState<number | null>(null);

  async function runHome() {
    setHomeStatus("running");
    setHomeResult("");
    setHomeMs(null);
    const t0 = Date.now();
    try {
      const data = await scrapeWitanimeHome();
      const elapsed = Date.now() - t0;
      setHomeMs(elapsed);
      setHomeStatus("ok");
      setHomeResult(
        `featured: ${data.featured.length}\n` +
        `animes: ${data.animes.length}\n` +
        `episodes: ${data.episodes.length}\n\n` +
        `first featured: ${data.featured[0]?.title ?? "(none)"}\n` +
        `first anime: ${data.animes[0]?.title ?? "(none)"}\n` +
        `first episode: ${data.episodes[0]?.title ?? "(none)"}\n\n` +
        `raw (truncated):\n${JSON.stringify(data, null, 2).slice(0, 2000)}`
      );
    } catch (e: any) {
      setHomeMs(Date.now() - t0);
      setHomeStatus("err");
      setHomeResult(`ERROR: ${e?.message ?? String(e)}`);
    }
  }

  async function runVideo() {
    if (!embedUrl.trim()) {
      setVideoStatus("err");
      setVideoResult("Paste an embed URL first");
      return;
    }
    setVideoStatus("running");
    setVideoResult("");
    setVideoMs(null);
    const t0 = Date.now();
    try {
      const data = await extractVideoUrl(embedUrl.trim());
      const elapsed = Date.now() - t0;
      setVideoMs(elapsed);
      setVideoStatus("ok");
      setVideoResult(`Found URL:\n${data.url}`);
    } catch (e: any) {
      setVideoMs(Date.now() - t0);
      setVideoStatus("err");
      setVideoResult(`ERROR: ${e?.message ?? String(e)}`);
    }
  }

  return (
    <View style={[ss.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <View style={ss.header}>
        <Pressable onPress={() => router.back()} style={ss.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
        <Text style={ss.title}>Scraper PoC</Text>
      </View>

      <ScrollView contentContainerStyle={ss.body}>
        {/* Home scrape */}
        <View style={ss.card}>
          <Text style={ss.cardTitle}>1. Witanime home scrape</Text>
          <Text style={ss.cardSub}>Loads witanime.you in a hidden WebView, waits for CF clear, extracts featured + cards + episodes.</Text>
          <Pressable
            style={({ pressed }) => [ss.btn, pressed && { opacity: 0.8 }, homeStatus === "running" && { opacity: 0.5 }]}
            onPress={runHome}
            disabled={homeStatus === "running"}
          >
            {homeStatus === "running" ? <ActivityIndicator color="#fff" /> : <Text style={ss.btnText}>Run home scrape</Text>}
          </Pressable>
          {homeMs !== null && <Text style={ss.meta}>{homeMs} ms · {homeStatus.toUpperCase()}</Text>}
          {!!homeResult && <Text style={[ss.result, homeStatus === "err" && { color: "#ff6b6b" }]}>{homeResult}</Text>}
        </View>

        {/* Video extraction */}
        <View style={ss.card}>
          <Text style={ss.cardTitle}>2. Video URL extraction</Text>
          <Text style={ss.cardSub}>Loads an embed page (mp4upload, vidstream, etc.) with fetch/XHR hooks. Reports first m3u8/mp4 URL.</Text>
          <TextInput
            value={embedUrl}
            onChangeText={setEmbedUrl}
            placeholder="Paste embed URL (https://...)"
            placeholderTextColor="#666"
            style={ss.input}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={({ pressed }) => [ss.btn, pressed && { opacity: 0.8 }, videoStatus === "running" && { opacity: 0.5 }]}
            onPress={runVideo}
            disabled={videoStatus === "running"}
          >
            {videoStatus === "running" ? <ActivityIndicator color="#fff" /> : <Text style={ss.btnText}>Extract video URL</Text>}
          </Pressable>
          {videoMs !== null && <Text style={ss.meta}>{videoMs} ms · {videoStatus.toUpperCase()}</Text>}
          {!!videoResult && <Text style={[ss.result, videoStatus === "err" && { color: "#ff6b6b" }]}>{videoResult}</Text>}
        </View>
      </ScrollView>
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  title: { color: C.text, fontSize: 20, fontWeight: "700" },
  body: { gap: 16, paddingBottom: 40 },
  card: {
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: 16, padding: 16, gap: 10,
  },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: "700" },
  cardSub: { color: C.textSecondary, fontSize: 12, lineHeight: 16 },
  input: {
    backgroundColor: "#0008", color: C.text, fontSize: 12,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: C.glassBorder,
  },
  btn: {
    backgroundColor: C.accent, borderRadius: 999, paddingVertical: 12,
    alignItems: "center", marginTop: 4,
  },
  btnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  meta: { color: C.textMuted, fontSize: 11, marginTop: 4 },
  result: {
    color: C.text, fontSize: 11, marginTop: 8, lineHeight: 16,
    fontFamily: "monospace",
  },
});
