// Pantoufa Wrapped — the user's anime year as a shareable story card.

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth";
import { profileName } from "../lib/profile";
import { fetchTopGenres, loadWrapped, publishWrapped, toPublicPayload, type WrappedStats } from "../lib/wrapped";
import { canShareImage, shareViewAsImage } from "../lib/shareImage";
import { WrappedCard } from "../components/WrappedCard";
import { C, R } from "../lib/theme";
import { t } from "../lib/i18n";

export default function WrappedScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const name = profileName(user, "");
  const [stats, setStats] = useState<WrappedStats | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [busy, setBusy] = useState<"image" | "link" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const cardRef = useRef<View>(null);
  const imageShare = canShareImage();

  // A story card is portrait; never inherit the player's landscape lock.
  useFocusEffect(useCallback(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []));

  useEffect(() => {
    let alive = true;
    void loadWrapped().then(async (s) => {
      if (!alive) return;
      setStats(s);
      const g = await fetchTopGenres(s);
      if (alive) setGenres(g);
    });
    return () => { alive = false; };
  }, []);

  const shareLink = useCallback(async () => {
    if (!stats || busy) return;
    setBusy("link");
    setMsg(null);
    const url = await publishWrapped(toPublicPayload(stats, name, genres));
    setBusy(null);
    if (!url) {
      setMsg(t.wrappedShareFailed);
      return;
    }
    try {
      await Share.share({ message: t.wrappedShareText(stats.year, Math.floor(stats.minutes / 60), url) });
    } catch {}
  }, [stats, busy, name, genres]);

  const shareImage = useCallback(async () => {
    if (!stats || busy) return;
    setBusy("image");
    setMsg(null);
    const ok = await shareViewAsImage(cardRef.current, t.wrappedTitle);
    setBusy(null);
    if (!ok) await shareLink();
  }, [stats, busy, shareLink]);

  // Full-width card: it grows with its content and the screen scrolls, so
  // long names/titles never get clipped.
  const cardW = Math.min(width - 32, 420);

  return (
    <View style={[ss.root, { paddingTop: insets.top }]}>
      <View style={ss.header}>
        <Pressable onPress={() => router.back()} style={ss.back} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.back}>
          <Ionicons name="chevron-forward" size={22} color={C.text} />
        </Pressable>
        <Text style={ss.title}>{t.wrappedTitle}</Text>
      </View>

      {!stats ? (
        <View style={ss.center}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={ss.hint}>{t.wrappedLoading}</Text>
        </View>
      ) : stats.episodes === 0 ? (
        <View style={ss.center}>
          <Text style={{ fontSize: 44 }}>✨</Text>
          <Text style={ss.emptyTitle}>{t.wrappedEmptyTitle}</Text>
          <Text style={ss.hint}>{t.wrappedEmptyHint}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[ss.content, { paddingBottom: insets.bottom + 24 }]}>
          <WrappedCard ref={cardRef} stats={stats} name={name} genres={genres} width={cardW} />
          <View style={ss.actions}>
            {imageShare && (
              <Pressable onPress={shareImage} style={[ss.btn, ss.btnPrimary]} disabled={!!busy} accessibilityRole="button">
                {busy === "image" ? <ActivityIndicator size="small" color={C.textOnAccent} /> : <Ionicons name="image-outline" size={17} color={C.textOnAccent} />}
                <Text style={ss.btnPrimaryText}>{t.wrappedShareImage}</Text>
              </Pressable>
            )}
            <Pressable onPress={shareLink} style={[ss.btn, imageShare ? ss.btnGhost : ss.btnPrimary]} disabled={!!busy} accessibilityRole="button">
              {busy === "link" ? (
                <ActivityIndicator size="small" color={imageShare ? C.text : C.textOnAccent} />
              ) : (
                <Ionicons name="link-outline" size={17} color={imageShare ? C.text : C.textOnAccent} />
              )}
              <Text style={imageShare ? ss.btnGhostText : ss.btnPrimaryText}>{t.wrappedShareLink}</Text>
            </Pressable>
          </View>
          {msg ? <Text style={ss.msg}>{msg}</Text> : null}
          {!imageShare && <Text style={ss.note}>{t.wrappedImageNeedsUpdate}</Text>}
          <Text style={ss.note}>{t.wrappedPrivacy}</Text>
        </ScrollView>
      )}
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { direction: "ltr", flexDirection: "row-reverse", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  back: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
  },
  title: { flex: 1, color: C.text, fontSize: 20, fontFamily: "Cairo_700Bold", textAlign: "right", marginRight: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  hint: { color: C.textMuted, fontSize: 13, fontFamily: "Cairo_500Medium", textAlign: "center", marginTop: 12 },
  emptyTitle: { color: C.text, fontSize: 17, fontFamily: "Cairo_700Bold", textAlign: "center", marginTop: 12 },
  content: { alignItems: "center", paddingTop: 6, paddingHorizontal: 16 },
  actions: { width: "100%", maxWidth: 420, marginTop: 18 },
  btn: {
    direction: "ltr", flexDirection: "row-reverse", alignItems: "center", justifyContent: "center",
    minHeight: 50, borderRadius: R.lg, marginBottom: 10,
  },
  btnPrimary: { backgroundColor: C.accent },
  btnPrimaryText: { color: C.textOnAccent, fontSize: 15, fontFamily: "Cairo_700Bold", marginRight: 8 },
  btnGhost: { backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  btnGhostText: { color: C.text, fontSize: 15, fontFamily: "Cairo_700Bold", marginRight: 8 },
  msg: { color: C.error, fontSize: 12, fontFamily: "Cairo_500Medium", textAlign: "center", marginTop: 4 },
  note: { color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium", textAlign: "center", marginTop: 6, maxWidth: 420 },
});
