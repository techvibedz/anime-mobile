import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  AppState,
} from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../../lib/auth";
import { isAdmin } from "../../lib/presence";
import { adminListChats, type AdminChatSummary } from "../../lib/adminChat";
import { C, S, R, ELEVATION_CARD } from "../../lib/theme";
import { t } from "../../lib/i18n";
import { Aurora, ScreenHeader } from "../../components/ScreenChrome";

// "منذ ..." relative time shared with the other admin screens.
function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return t.liveJustNow;
  const min = Math.floor(ms / 60000);
  if (min < 1) return t.liveJustNow;
  if (min < 60) return t.liveMinutes(min);
  const h = Math.floor(min / 60);
  if (h < 24) return t.liveHours(h);
  return t.usersDays(Math.floor(h / 24));
}

export default function AdminChatsScreen() {
  const insets = useSafeAreaInsets();
  const { user, ready } = useAuth();
  const [rows, setRows] = useState<AdminChatSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const admin = isAdmin(user?.email);

  useEffect(() => {
    if (ready && !admin) router.replace("/(tabs)");
  }, [ready, admin]);

  const load = useCallback(async () => {
    const next = await adminListChats();
    setRows(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (admin) load();
  }, [admin, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Re-poll on foreground return so newly-arrived threads surface without a
  // manual pull-to-refresh. Cheap (one RPC), same pattern as the live-users
  // screen.
  useEffect(() => {
    if (!admin) return;
    const sub = AppState.addEventListener?.("change", (s: string) => {
      if (s === "active") load();
    });
    return () => sub?.remove?.();
  }, [admin, load]);

  if (!admin) return null;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.chatAdminInboxTitle} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: S.paddingContent, paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />
        }
      >
        <View style={s.introCard}>
          <LinearGradient
            colors={[C.accentSoft, "transparent"]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={s.introRow}>
            <View style={s.introIcon}>
              <Ionicons name="chatbubbles-outline" size={22} color={C.accent} />
            </View>
            <View style={s.introBody}>
              <Text style={s.introCount}>{rows.length}</Text>
              <Text style={s.introSub}>{t.chatAdminInboxSub}</Text>
            </View>
          </View>
        </View>

        {!loaded ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={C.accent} />
          </View>
        ) : rows.length === 0 ? (
          <View style={s.emptyWrap}>
            <View style={s.emptyIcon}>
              <Ionicons name="chatbubble-ellipses-outline" size={30} color={C.textMuted} />
            </View>
            <Text style={s.emptyTitle}>{t.chatInboxEmpty}</Text>
            <Text style={s.emptySub}>{t.chatInboxEmptySub}</Text>
          </View>
        ) : (
          <View style={s.list}>
            {rows.map((c) => {
              const closed = c.status === "closed";
              const initial = (c.userName || c.userEmail || "?").trim().charAt(0).toUpperCase();
              return (
                <Pressable
                  key={c.id}
                  style={({ pressed }) => [s.row, pressed && s.rowPressed, closed && s.rowClosed]}
                  onPress={() =>
                    router.push({
                      pathname: "/admin/chat/[id]",
                      params: {
                        id: c.id,
                        name: c.userName,
                        email: c.userEmail,
                        avatar: c.userAvatar ?? "",
                      },
                    })
                  }
                >
                  <Ionicons name="chevron-back" size={18} color={C.textMuted} style={s.rowChevron} />
                  <View style={s.rowBody}>
                    <Text style={s.rowName} numberOfLines={1}>
                      {c.userName || c.userEmail}
                    </Text>
                    <Text style={s.rowPreview} numberOfLines={1}>
                      {c.lastMessageBody || t.chatNoMessages}
                    </Text>
                    <View style={s.rowMeta}>
                      {closed ? (
                        <View style={[s.statusPill, s.statusPillClosed]}>
                          <Ionicons name="lock-closed-outline" size={10} color={C.textMuted} />
                          <Text style={[s.statusText, s.statusTextClosed]}>{t.chatStatusClosed}</Text>
                        </View>
                      ) : (
                        <View style={[s.statusPill, s.statusPillOpen]}>
                          <View style={s.statusDot} />
                          <Text style={[s.statusText, s.statusTextOpen]}>{t.chatStatusOpen}</Text>
                        </View>
                      )}
                      {c.lastMessageAt ? (
                        <Text style={s.rowTime}>{timeAgo(c.lastMessageAt)}</Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={s.avatarWrap}>
                    {c.userAvatar ? (
                      <Image source={{ uri: c.userAvatar }} style={s.avatar} contentFit="cover" transition={120} />
                    ) : (
                      <View style={[s.avatar, s.avatarFallback]}>
                        <Text style={s.avatarInitial}>{initial}</Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  introCard: {
    borderRadius: R.xxl, padding: 18, overflow: "hidden",
    backgroundColor: C.surfaceCard, borderWidth: 1, borderColor: C.borderAccent,
    ...ELEVATION_CARD,
  },
  introRow: { flexDirection: "row", alignItems: "center" },
  introIcon: {
    width: 46, height: 46, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  introBody: { flex: 1, marginRight: 12, alignItems: "flex-end" },
  introCount: { color: C.text, fontSize: 34, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  introSub: { color: C.textSecondary, fontSize: 12.5, marginTop: 4, textAlign: "right", fontFamily: "Cairo_500Medium", lineHeight: 18 },

  list: { marginTop: 16, gap: 10 },
  row: {
    flexDirection: "row", alignItems: "center", padding: 14, borderRadius: R.lg,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  rowPressed: { opacity: 0.6 },
  rowClosed: { opacity: 0.65 },
  rowChevron: { marginRight: 2 },
  rowBody: { flex: 1, marginRight: 12, alignItems: "flex-end" },
  rowName: { color: C.text, fontSize: 15, fontWeight: "700", fontFamily: "Cairo_700Bold", textAlign: "right" },
  rowPreview: { color: C.textSecondary, fontSize: 12.5, marginTop: 4, fontFamily: "Cairo_500Medium", textAlign: "right" },
  rowMeta: { flexDirection: "row-reverse", alignItems: "center", gap: 8, marginTop: 9 },

  statusPill: {
    flexDirection: "row-reverse", alignItems: "center", gap: 5,
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  statusPillOpen: { borderColor: C.successSoft, backgroundColor: C.successSoft },
  statusPillClosed: { borderColor: "rgba(255,255,255,0.06)", backgroundColor: C.surfaceLight },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  statusText: { fontSize: 10, fontWeight: "700", fontFamily: "Cairo_700Bold" },
  statusTextOpen: { color: C.success },
  statusTextClosed: { color: C.textMuted },
  rowTime: { color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium" },

  avatarWrap: { width: 46, height: 46 },
  avatar: { width: 46, height: 46, borderRadius: R.circle },
  avatarFallback: { backgroundColor: C.bgDeep, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.borderViolet },
  avatarInitial: { color: C.text, fontSize: 18, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },

  loadingWrap: { paddingVertical: 60, alignItems: "center" },
  emptyWrap: { alignItems: "center", paddingVertical: 56 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: R.circle, marginBottom: 14,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "700", fontFamily: "Cairo_700Bold" },
  emptySub: { color: C.textMuted, fontSize: 13, marginTop: 6, textAlign: "center", fontFamily: "Cairo_500Medium", lineHeight: 19 },
});