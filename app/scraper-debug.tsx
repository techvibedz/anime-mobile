import { useState } from "react";
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { scrapeWitanimeHome, extractVideoUrl } from "../lib/scraper";
import { diagnoseAnime3rb } from "../lib/api";
import { C } from "../lib/theme";
import Constants from "expo-constants";
import * as Updates from "expo-updates";

export default function ScraperDebug() {
  const insets = useSafeAreaInsets();
  const [homeStatus, setHomeStatus] = useState<"idle" | "running" | "ok" | "err">("idle");
  const [homeResult, setHomeResult] = useState<string>("");
  const [homeMs, setHomeMs] = useState<number | null>(null);

  const [embedUrl, setEmbedUrl] = useState("");
  const [videoStatus, setVideoStatus] = useState<"idle" | "running" | "ok" | "err">("idle");
  const [videoResult, setVideoResult] = useState<string>("");
  const [videoMs, setVideoMs] = useState<number | null>(null);

  // anime3rb chain diagnostic
  const [a3rbTitle, setA3rbTitle] = useState("Jujutsu Kaisen");
  const [a3rbEp, setA3rbEp] = useState("1");
  const [a3rbStatus, setA3rbStatus] = useState<"idle" | "running" | "ok" | "err">("idle");
  const [a3rbResult, setA3rbResult] = useState<string>("");

  async function runA3rb() {
    setA3rbStatus("running");
    setA3rbResult("");
    try {
      const out = await diagnoseAnime3rb(a3rbTitle.trim(), parseInt(a3rbEp, 10) || 1);
      setA3rbStatus(/→ OK:/.test(out) ? "ok" : "err");
      setA3rbResult(out);
    } catch (e: any) {
      setA3rbStatus("err");
      setA3rbResult(`ERROR: ${e?.message ?? String(e)}`);
    }
  }

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
        {/* Build / bundle identity — confirm the fix actually reached this device */}
        <View style={ss.card}>
          <Text style={ss.cardTitle}>Build</Text>
          <Text style={ss.meta}>
            app version: {Constants.expoConfig?.version ?? "?"}{"\n"}
            runtime: {(Updates.runtimeVersion as string) ?? "?"}{"\n"}
            OTA channel: {(Updates.channel as string) ?? "(embedded)"}{"\n"}
            OTA update id: {(Updates.updateId as string) ?? "(none — running embedded bundle)"}{"\n"}
            OTA created: {Updates.createdAt ? new Date(Updates.createdAt).toLocaleString() : "(embedded)"}
          </Text>
        </View>

        {/* anime3rb chain diagnostic */}
        <View style={ss.card}>
          <Text style={ss.cardTitle}>0. anime3rb chain test</Text>
          <Text style={ss.cardSub}>Runs resolve → episode → player → extract and shows where it breaks. Use any anime name + episode number.</Text>
          <TextInput
            value={a3rbTitle}
            onChangeText={setA3rbTitle}
            placeholder="Anime title"
            placeholderTextColor="#666"
            style={ss.input}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            value={a3rbEp}
            onChangeText={setA3rbEp}
            placeholder="Episode #"
            placeholderTextColor="#666"
            style={ss.input}
            keyboardType="number-pad"
          />
          <Pressable
            style={({ pressed }) => [ss.btn, pressed && { opacity: 0.8 }, a3rbStatus === "running" && { opacity: 0.5 }]}
            onPress={runA3rb}
            disabled={a3rbStatus === "running"}
          >
            {a3rbStatus === "running" ? <ActivityIndicator color="#fff" /> : <Text style={ss.btnText}>Run anime3rb test</Text>}
          </Pressable>
          {!!a3rbResult && <Text style={[ss.result, a3rbStatus === "err" && { color: "#ff6b6b" }, a3rbStatus === "ok" && { color: "#51cf66" }]}>{a3rbResult}</Text>}
        </View>

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
