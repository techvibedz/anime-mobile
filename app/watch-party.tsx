import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../lib/auth";
import {
  createRoom,
  joinRoom,
  leaveRoom,
  subscribeRoom,
  subscribeMembers,
  subscribeState,
  type PartyMember,
  type PartyRole,
} from "../lib/watchParty";
import { C, S, R, ELEVATION_CARD } from "../lib/theme";
import { t } from "../lib/i18n";
import { Aurora, ScreenHeader } from "../components/ScreenChrome";

function Avatars({ members, meId }: { members: PartyMember[]; meId?: string }) {
  return (
    <View style={s.list}>
      {members.map((m) => {
        const initial = (m.name || "?").trim().charAt(0).toUpperCase();
        return (
          <View key={m.userId} style={s.row}>
            <View style={s.rowBody}>
              <Text style={s.rowName} numberOfLines={1}>
                {m.name}{m.userId === meId ? ` · ${t.wpYou}` : ""}
              </Text>
              <View style={s.tagRow}>
                {m.isHost ? <Text style={s.hostTag}>{t.wpHost}</Text> : null}
                {(m.isHost || m.ready) ? (
                  <View style={s.readyTag}>
                    <Ionicons name="checkmark-circle" size={11} color={C.success} />
                    <Text style={s.readyTagText}>{t.wpReady}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View style={s.avatarWrap}>
              {m.avatarUrl ? (
                <Image source={{ uri: m.avatarUrl }} style={s.avatar} contentFit="cover" transition={120} />
              ) : (
                <View style={[s.avatar, s.avatarFallback]}>
                  <Text style={s.avatarInitial}>{initial}</Text>
                </View>
              )}
              {m.isHost ? <View style={s.hostDot}><Ionicons name="star" size={8} color={C.black} /></View> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function WatchPartyScreen() {
  const insets = useSafeAreaInsets();
  const { user, ready } = useAuth();

  const [roomInfo, setRoomInfo] = useState<{ code: string; role: PartyRole } | null>(null);
  const [members, setMembers] = useState<PartyMember[]>([]);
  const [codeInput, setCodeInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => subscribeRoom(setRoomInfo), []);
  useEffect(() => subscribeMembers(setMembers), []);

  // Client: the instant the host broadcasts an episode, follow into the player.
  useEffect(() => {
    if (roomInfo?.role !== "client") return;
    let navigated = false; // fire the hop once; later broadcasts are the player's job
    return subscribeState((st) => {
      if (st.episode && !navigated) {
        navigated = true;
        router.replace({ pathname: `/watch/${encodeURIComponent(st.episode)}`, params: { ...st.params, auto: "1" } });
      }
    });
  }, [roomInfo?.role]);

  const onCreate = useCallback(async () => {
    if (!user) { setErr(t.wpSignInRequired); return; }
    setBusy(true); setErr(null);
    try { await createRoom(user); } catch { setErr(t.signInFailed); }
    setBusy(false);
  }, [user]);

  const onJoin = useCallback(async () => {
    if (!user) { setErr(t.wpSignInRequired); return; }
    const code = codeInput.trim().toUpperCase();
    if (code.length < 4) { setErr(t.wpInvalidCode); return; }
    setBusy(true); setErr(null);
    try { await joinRoom(code, user); } catch { setErr(t.wpInvalidCode); }
    setBusy(false);
  }, [user, codeInput]);

  const onLeave = useCallback(async () => { await leaveRoom(); }, []);

  if (!ready) return null;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.wpTitle} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: S.paddingContent, paddingBottom: insets.bottom + 40 }}
      >
        {roomInfo ? (
          /* ── In a room: waiting area ── */
          <>
            <View style={s.codeCard}>
              <LinearGradient
                colors={[C.accentSoft, "transparent"]}
                start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <Text style={s.codeLabel}>{t.wpRoomCode}</Text>
              <Text style={s.codeText}>{roomInfo.code}</Text>
              {roomInfo.role === "host" ? (
                <Text style={s.codeHint}>{t.wpShareHint}</Text>
              ) : (
                <Text style={s.codeHint}>{t.wpHostPicking}</Text>
              )}
            </View>

            <View style={s.waitRow}>
              <View style={s.liveDot} />
              <Text style={s.waitText}>
                {members.length > 1 ? t.wpInRoom(members.length) : t.wpWaiting}
              </Text>
            </View>

            <Avatars members={members} meId={user?.id} />

            {roomInfo.role === "host" ? (
              <Pressable style={s.primaryBtn} onPress={() => router.replace("/(tabs)")}>
                <Ionicons name="play" size={18} color={C.black} />
                <Text style={s.primaryBtnText}>{t.wpStartWatching}</Text>
              </Pressable>
            ) : (
              <View style={s.followBanner}>
                <ActivityIndicator size="small" color={C.accent} />
                <Text style={s.followText}>{t.wpHostPicking}</Text>
              </View>
            )}
            {roomInfo.role === "host" ? (
              <Text style={s.startHint}>{t.wpStartWatchingHint}</Text>
            ) : null}

            <Pressable style={s.leaveBtn} onPress={onLeave}>
              <Ionicons name="exit-outline" size={16} color={C.error} />
              <Text style={s.leaveText}>{t.wpLeave}</Text>
            </Pressable>
          </>
        ) : (
          /* ── Not in a room: create / join ── */
          <>
            <Text style={s.intro}>{t.wpSub}</Text>

            <Pressable style={[s.primaryBtn, busy && { opacity: 0.6 }]} onPress={onCreate} disabled={busy}>
              {busy ? (
                <ActivityIndicator size="small" color={C.black} />
              ) : (
                <Ionicons name="add-circle" size={18} color={C.black} />
              )}
              <Text style={s.primaryBtnText}>{busy ? t.wpCreating : t.wpCreate}</Text>
            </Pressable>

            <View style={s.dividerRow}>
              <View style={s.divider} />
              <Text style={s.orText}>{t.or}</Text>
              <View style={s.divider} />
            </View>

            <View style={s.joinCard}>
              <TextInput
                style={s.codeInput}
                value={codeInput}
                onChangeText={(v) => setCodeInput(v.toUpperCase())}
                placeholder={t.wpJoinPlaceholder}
                placeholderTextColor={C.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
                textAlign="center"
              />
              <Pressable style={[s.joinBtn, busy && { opacity: 0.6 }]} onPress={onJoin} disabled={busy}>
                <Text style={s.joinBtnText}>{t.wpJoin}</Text>
              </Pressable>
            </View>

            {err ? <Text style={s.err}>{err}</Text> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  intro: { color: C.textSecondary, fontSize: 14, lineHeight: 22, textAlign: "right", fontFamily: "Cairo_500Medium", marginBottom: 22 },

  codeCard: {
    borderRadius: R.xxl, padding: 22, overflow: "hidden", alignItems: "center",
    backgroundColor: C.surfaceCard, borderWidth: 1, borderColor: C.borderAccent,
    ...ELEVATION_CARD,
  },
  codeLabel: { color: C.textSecondary, fontSize: 12, fontFamily: "Cairo_600SemiBold" },
  codeText: { color: C.accent, fontSize: 44, letterSpacing: 8, fontFamily: "Outfit_900Black", marginTop: 6 },
  codeHint: { color: C.textMuted, fontSize: 12, marginTop: 10, textAlign: "center", fontFamily: "Cairo_500Medium" },

  waitRow: { flexDirection: "row-reverse", alignItems: "center", marginTop: 22, marginBottom: 4 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.success, marginLeft: 8 },
  waitText: { color: C.text, fontSize: 14, fontFamily: "Cairo_700Bold" },

  list: { marginTop: 12, gap: 8 },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 12, borderRadius: R.lg,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  rowBody: { flex: 1, marginHorizontal: 12, alignItems: "flex-end" },
  rowName: { color: C.text, fontSize: 15, fontFamily: "Cairo_700Bold", textAlign: "right" },
  tagRow: { flexDirection: "row-reverse", alignItems: "center", gap: 8, marginTop: 2 },
  hostTag: { color: C.accent, fontSize: 11, fontFamily: "Cairo_600SemiBold" },
  readyTag: { flexDirection: "row-reverse", alignItems: "center", gap: 3 },
  readyTagText: { color: C.success, fontSize: 11, fontFamily: "Cairo_600SemiBold" },
  avatarWrap: { width: 46, height: 46 },
  avatar: { width: 46, height: 46, borderRadius: R.circle },
  avatarFallback: { backgroundColor: C.bgDeep, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.borderViolet },
  avatarInitial: { color: C.text, fontSize: 18, fontFamily: "Outfit_800ExtraBold" },
  hostDot: {
    position: "absolute", bottom: 0, right: 0, width: 16, height: 16, borderRadius: 8,
    backgroundColor: C.accent, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: C.surface,
  },

  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: S.inputHeight, borderRadius: R.pill, backgroundColor: C.accent, marginTop: 24,
  },
  primaryBtnText: { color: C.black, fontSize: 15, fontFamily: "Cairo_700Bold" },
  startHint: { color: C.textMuted, fontSize: 12, textAlign: "center", marginTop: 10, fontFamily: "Cairo_500Medium" },

  followBanner: {
    flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 10,
    marginTop: 24, padding: 14, borderRadius: R.lg,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  followText: { color: C.textSecondary, fontSize: 13, fontFamily: "Cairo_600SemiBold" },

  leaveBtn: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 18, padding: 10 },
  leaveText: { color: C.error, fontSize: 14, fontFamily: "Cairo_600SemiBold" },

  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 22 },
  divider: { flex: 1, height: 1, backgroundColor: C.border },
  orText: { color: C.textMuted, fontSize: 12, fontFamily: "Cairo_500Medium" },

  joinCard: { flexDirection: "row", alignItems: "center", gap: 10 },
  codeInput: {
    flex: 1, height: S.inputHeight, borderRadius: R.lg,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderLight,
    color: C.text, fontSize: 18, letterSpacing: 4, fontFamily: "Outfit_700Bold",
  },
  joinBtn: {
    height: S.inputHeight, paddingHorizontal: 22, borderRadius: R.lg,
    backgroundColor: C.surfaceLight, borderWidth: 1, borderColor: C.borderAccent,
    alignItems: "center", justifyContent: "center",
  },
  joinBtnText: { color: C.text, fontSize: 15, fontFamily: "Cairo_700Bold" },

  err: { color: C.error, fontSize: 13, textAlign: "center", marginTop: 16, fontFamily: "Cairo_600SemiBold" },
});
