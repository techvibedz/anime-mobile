// Server/quality picker shown before a download starts, so the user chooses the
// source + resolution (FHD/HD/SD) instead of getting whatever the auto-pick
// lands on. Reused by the anime detail grid and the watch screen. The .mp4 URL
// for the chosen server is resolved lazily inside startDownload, so opening the
// picker only costs the cheap server-list scrape.

import { useEffect, useState } from "react";
import { View, Text, Pressable, Modal, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { listDownloadServers, type DownloadServer } from "../lib/api";
import { startDownload, type DownloadMeta } from "../lib/downloads";
import { C, R } from "../lib/theme";
import { t } from "../lib/i18n";

function sourceLabel(provider: string): string {
  if (provider === "vid3rb") return "Anime3rb";
  if (provider === "mp4upload") return "Mp4upload";
  return provider;
}

export function DownloadPicker({
  visible,
  meta,
  onClose,
}: {
  visible: boolean;
  meta: DownloadMeta | null;
  onClose: () => void;
}) {
  // null = still loading the server list; [] = none found.
  const [servers, setServers] = useState<DownloadServer[] | null>(null);

  useEffect(() => {
    if (!visible || !meta) {
      setServers(null);
      return;
    }
    let alive = true;
    setServers(null);
    listDownloadServers({
      episodeHref: meta.episodeHref,
      url4up: meta.url4up,
      url3rb: meta.url3rb,
      epNum: meta.epNum,
      animeTitle: meta.animeTitle,
    })
      .then((list) => alive && setServers(list))
      .catch(() => alive && setServers([]));
    return () => {
      alive = false;
    };
  }, [visible, meta]);

  const pick = (s: DownloadServer) => {
    if (!meta) return;
    startDownload({
      ...meta,
      server: { name: s.name, iframeUrl: s.iframeUrl, provider: s.provider, quality: s.quality },
    });
    onClose();
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose}>
        <Pressable style={st.sheet} onPress={() => {}}>
          <Text style={st.title}>{t.chooseDownloadServer}</Text>
          <Text style={st.sub}>{t.chooseDownloadServerSub}</Text>

          {servers === null ? (
            <View style={st.loading}>
              <ActivityIndicator color={C.accent} />
              <Text style={st.loadingText}>{t.loadingServers}</Text>
            </View>
          ) : servers.length === 0 ? (
            <Text style={st.empty}>{t.downloadNoServer}</Text>
          ) : (
            servers.map((s, i) => {
              const fhd = s.quality === "FHD";
              return (
                <Pressable key={`${s.provider}-${i}`} style={st.option} onPress={() => pick(s)}>
                  <View style={[st.qBadge, fhd && st.qBadgeFhd]}>
                    <Text style={[st.qText, fhd && st.qTextFhd]}>{s.quality || "—"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.optTitle}>{s.name}</Text>
                    <Text style={st.optSub}>{sourceLabel(s.provider)}</Text>
                  </View>
                  <Ionicons name="download-outline" size={18} color={C.textMuted} />
                </Pressable>
              );
            })
          )}

          <Pressable style={st.cancel} onPress={onClose}>
            <Text style={st.cancelText}>{t.cancel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: C.bg,
    borderRadius: R.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  title: {
    color: C.text,
    fontSize: 18,
    fontWeight: "700",
    fontFamily: "Cairo_700Bold",
    textAlign: "center",
  },
  sub: {
    color: C.textMuted,
    fontSize: 12,
    textAlign: "center",
    fontFamily: "Cairo_500Medium",
    marginBottom: 8,
  },
  loading: { paddingVertical: 28, alignItems: "center", gap: 10 },
  loadingText: { color: C.textMuted, fontSize: 12, fontFamily: "Cairo_500Medium" },
  empty: {
    color: C.textMuted,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 24,
    fontFamily: "Cairo_500Medium",
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: R.lg,
    backgroundColor: C.glass,
    borderWidth: 1,
    borderColor: C.glassBorder,
  },
  // The FHD pill earns the single ember spark — it's the privileged choice.
  qBadge: {
    minWidth: 46,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: R.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,241,234,0.06)",
  },
  qBadgeFhd: { backgroundColor: C.accentSoft },
  qText: { color: C.textSecondary, fontSize: 12, fontWeight: "800", fontFamily: "DMSans_700Bold" },
  qTextFhd: { color: C.accent },
  optTitle: { color: C.text, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },
  optSub: { color: C.textMuted, fontSize: 11, marginTop: 2, fontFamily: "DMSans_500Medium" },
  cancel: { paddingVertical: 10, alignItems: "center", marginTop: 4 },
  cancelText: { color: C.textMuted, fontSize: 13, fontWeight: "600", fontFamily: "Cairo_500Medium" },
});
