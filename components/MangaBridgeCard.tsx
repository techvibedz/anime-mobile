// "Continue the story in the manga" card (anime detail page + end of the
// last episode in the player).
//
// Shows where this season ends in its source manga and opens the reader at
// the next chapter. Users can correct the chapter (one vote each); enough
// agreeing votes override the AI's answer for everyone.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ScreenOrientation from "expo-screen-orientation";
import { C, R } from "../lib/theme";
import { t } from "../lib/i18n";
import { openBridgeChapter, prefetchBridgeManga, voteMangaBridge, type BridgeInfo } from "../lib/mangaBridge";

export function MangaBridgeCard({
  info,
  animeTitle,
  onVoted,
  compact = false,
  beforeOpen,
}: {
  info: BridgeInfo;
  animeTitle: string;
  /** Called after a successful vote so the parent can re-fetch. */
  onVoted?: () => void;
  /** Player overlay variant: one line + the read button, no editor. */
  compact?: boolean;
  /** Hook to pause/clean up before navigating (player). */
  beforeOpen?: () => void;
}) {
  const { payload, view } = info;
  const novel = payload.source === "light_novel" || payload.source === "web_novel";
  const [opening, setOpening] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(view.endChapter == null && !novel && !compact);
  const [value, setValue] = useState(view.endChapter != null ? String(view.endChapter) : "");
  const [sending, setSending] = useState(false);

  const open = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    setMsg(null);
    beforeOpen?.();
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    const res = await openBridgeChapter(payload, animeTitle, view.continueChapter);
    setOpening(false);
    if (res === "notfound") setMsg(t.bridgeNotFound);
    else if (res === "detail" && view.continueChapter != null) setMsg(t.bridgeChapterMissing(view.continueChapter));
  }, [opening, payload, animeTitle, view.continueChapter, beforeOpen]);

  const submit = useCallback(async () => {
    const n = parseFloat(
      value.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[^\d.]/g, ""),
    );
    if (!(n > 0) || n >= 10000) {
      setMsg(t.bridgeInvalid);
      return;
    }
    Keyboard.dismiss();
    setSending(true);
    const ok = await voteMangaBridge(info.key, n);
    setSending(false);
    if (ok) {
      setEditing(false);
      setMsg(t.bridgeThanks);
      onVoted?.();
    } else {
      setMsg(t.companionError);
    }
  }, [value, info.key, onVoted]);

  const canRead = view.continueChapter != null && (!novel || payload.mangaTitle);
  const willOpen = !!canRead || view.coversAll;

  // Resolve the manga in the sources while the user reads the card, so the
  // tap opens the reader almost instantly instead of searching from scratch.
  useEffect(() => {
    if (!willOpen) return;
    const timer = setTimeout(() => prefetchBridgeManga(payload, animeTitle), 1200);
    return () => clearTimeout(timer);
  }, [willOpen, payload, animeTitle]);

  if (compact) {
    if (!canRead) return null;
    return (
      <View style={ss.compact}>
        <View style={ss.compactText}>
          <Text style={ss.compactTitle} numberOfLines={1}>{t.bridgeAnimeEnded}</Text>
          <Text style={ss.compactSub} numberOfLines={1}>{t.bridgeContinueFrom(view.continueChapter!)}</Text>
          {msg ? <Text style={ss.msg} numberOfLines={2}>{msg}</Text> : null}
        </View>
        <Pressable onPress={open} disabled={opening} style={ss.readBtn} accessibilityRole="button">
          {opening ? <ActivityIndicator size="small" color={C.textOnAccent} /> : <Ionicons name="book" size={14} color={C.textOnAccent} />}
          <Text style={ss.readBtnText}>{t.bridgeRead}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={ss.card}>
      <View style={ss.head}>
        <View style={ss.icon}>
          <Ionicons name="book-outline" size={18} color={C.mint} />
        </View>
        <View style={ss.headText}>
          <Text style={ss.title}>{novel ? t.bridgeNovelTitle : t.bridgeTitle}</Text>
          {view.endChapter != null ? (
            <Text style={ss.sub}>
              {view.coversAll ? t.bridgeCoversAll(view.endChapter) : t.bridgeEndsAt(view.endChapter)}
              {view.continueChapter != null ? ` · ${t.bridgeContinueFrom(view.continueChapter)}` : ""}
            </Text>
          ) : novel && view.endVolume != null ? (
            <Text style={ss.sub}>{t.bridgeEndsAtVolume(view.endVolume)}</Text>
          ) : (
            <Text style={ss.sub}>{t.bridgeUnknown}</Text>
          )}
          {novel && view.endVolume != null && view.endChapter != null ? (
            <Text style={ss.subMuted}>{t.bridgeEndsAtVolume(view.endVolume)}</Text>
          ) : null}
        </View>
      </View>

      {(view.basis === "community" || view.uncertain || payload.airing) && view.endChapter != null && (
        <View style={ss.tags}>
          {view.basis === "community" && (
            <View style={ss.tag}><Text style={ss.tagText}>{t.bridgeConfirmed(view.agree)}</Text></View>
          )}
          {view.uncertain && (
            <View style={[ss.tag, ss.tagWarn]}><Text style={[ss.tagText, { color: C.gold }]}>{t.bridgeEstimate}</Text></View>
          )}
          {payload.airing && (
            <View style={ss.tag}><Text style={ss.tagText}>{t.bridgeAiring}</Text></View>
          )}
        </View>
      )}

      {payload.note ? <Text style={ss.note}>{payload.note}</Text> : null}

      {editing ? (
        <View style={ss.editRow}>
          <TextInput
            value={value}
            onChangeText={setValue}
            keyboardType="decimal-pad"
            placeholder={t.bridgeChapterPlaceholder}
            placeholderTextColor={C.textMuted}
            selectionColor={C.mint}
            style={ss.input}
            onSubmitEditing={submit}
            returnKeyType="send"
            accessibilityLabel={t.bridgeChapterPlaceholder}
          />
          <Pressable onPress={submit} style={ss.sendBtn} disabled={sending} accessibilityRole="button">
            {sending ? <ActivityIndicator size="small" color={C.bg} /> : <Text style={ss.sendText}>{t.bridgeSend}</Text>}
          </Pressable>
        </View>
      ) : (
        <View style={ss.actions}>
          {canRead && (
            <Pressable onPress={open} disabled={opening} style={({ pressed }) => [ss.readBtn, ss.readBtnMain, pressed && { opacity: 0.85 }]} accessibilityRole="button">
              {opening ? <ActivityIndicator size="small" color={C.textOnAccent} /> : <Ionicons name="book" size={14} color={C.textOnAccent} />}
              <Text style={ss.readBtnText} numberOfLines={1}>{opening ? t.bridgeSearching : t.bridgeReadFrom(view.continueChapter!)}</Text>
            </Pressable>
          )}
          {view.coversAll && (
            <Pressable onPress={open} disabled={opening} style={({ pressed }) => [ss.readBtn, ss.readBtnMain, pressed && { opacity: 0.85 }]} accessibilityRole="button">
              {opening ? <ActivityIndicator size="small" color={C.textOnAccent} /> : <Ionicons name="book" size={14} color={C.textOnAccent} />}
              <Text style={ss.readBtnText} numberOfLines={1}>{opening ? t.bridgeSearching : t.bridgeOpenManga}</Text>
            </Pressable>
          )}
          {!novel && (
            <Pressable onPress={() => { setEditing(true); setMsg(null); }} style={ss.fixBtn} accessibilityRole="button">
              <Ionicons name="create-outline" size={14} color={C.textSecondary} />
              <Text style={ss.fixText} numberOfLines={1}>{info.mine != null ? t.bridgeYourVote(info.mine) : t.bridgeFix}</Text>
            </Pressable>
          )}
        </View>
      )}
      {msg ? <Text style={ss.msg}>{msg}</Text> : null}
    </View>
  );
}

const ss = StyleSheet.create({
  card: {
    marginTop: 16, padding: 14, borderRadius: R.lg,
    backgroundColor: "rgba(94,234,212,0.06)", borderWidth: 1, borderColor: "rgba(94,234,212,0.26)",
  },
  head: { direction: "ltr", flexDirection: "row-reverse", alignItems: "center" },
  icon: {
    width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center",
    backgroundColor: C.mintSoft, marginLeft: 10,
  },
  headText: { flex: 1, alignItems: "flex-end" },
  title: { color: C.text, fontSize: 15, lineHeight: 24, fontFamily: "Cairo_700Bold", textAlign: "right" },
  sub: { color: C.textSecondary, fontSize: 12, lineHeight: 19, fontFamily: "Cairo_500Medium", textAlign: "right" },
  subMuted: { color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium", textAlign: "right" },
  tags: { direction: "ltr", flexDirection: "row-reverse", flexWrap: "wrap", marginTop: 10 },
  tag: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill, marginLeft: 6, marginBottom: 4,
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
  },
  tagWarn: { backgroundColor: "rgba(255,206,92,0.10)", borderColor: "rgba(255,206,92,0.30)" },
  tagText: { color: C.textSecondary, fontSize: 10, fontFamily: "Cairo_600SemiBold" },
  note: { color: C.textMuted, fontSize: 12, lineHeight: 19, fontFamily: "Cairo_500Medium", textAlign: "right", marginTop: 8 },
  actions: { direction: "ltr", flexDirection: "row-reverse", flexWrap: "wrap", alignItems: "center", marginTop: 12 },
  readBtn: {
    direction: "ltr", flexDirection: "row-reverse", alignItems: "center", justifyContent: "center",
    minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: C.mint,
  },
  readBtnMain: { flexShrink: 1, maxWidth: "100%" },
  readBtnText: { flexShrink: 1, color: C.textOnAccent, fontSize: 13, fontFamily: "Cairo_700Bold", marginRight: 6 },
  fixBtn: {
    direction: "ltr", flexDirection: "row-reverse", alignItems: "center",
    minHeight: 44, paddingHorizontal: 12, marginRight: 8, flexShrink: 1,
  },
  fixText: { flexShrink: 1, color: C.textSecondary, fontSize: 12, fontFamily: "Cairo_600SemiBold", marginRight: 4 },
  editRow: { direction: "ltr", flexDirection: "row-reverse", alignItems: "center", marginTop: 12 },
  input: {
    flex: 1, minHeight: 44, borderRadius: 12, paddingHorizontal: 12,
    color: C.text, backgroundColor: C.surfaceLight, borderWidth: 1, borderColor: C.border,
    fontFamily: "Outfit_600SemiBold", fontSize: 14, textAlign: "right",
  },
  sendBtn: {
    minHeight: 44, minWidth: 72, paddingHorizontal: 14, borderRadius: 12, marginRight: 8,
    alignItems: "center", justifyContent: "center", backgroundColor: C.mint,
  },
  sendText: { color: C.bg, fontSize: 13, fontFamily: "Cairo_700Bold" },
  msg: { color: C.textSecondary, fontSize: 12, lineHeight: 19, fontFamily: "Cairo_500Medium", textAlign: "right", marginTop: 8 },
  compact: {
    direction: "ltr", flexDirection: "row-reverse", alignItems: "center",
    padding: 12, borderRadius: 14,
    backgroundColor: "rgba(8,9,12,0.88)", borderWidth: 1, borderColor: "rgba(94,234,212,0.35)",
  },
  compactText: { flex: 1, alignItems: "flex-end", marginLeft: 10 },
  compactTitle: { color: C.white, fontSize: 13, fontFamily: "Cairo_700Bold", textAlign: "right" },
  compactSub: { color: C.mint, fontSize: 12, fontFamily: "Cairo_600SemiBold", textAlign: "right" },
});
