import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../lib/auth";
import { isAdmin, subscribeOnlineUsers, type OnlineUser } from "../lib/presence";
import { C, S, R, ELEVATION_CARD, ELEVATION_GLOW } from "../lib/theme";
import { t } from "../lib/i18n";
import { Aurora, ScreenHeader } from "../components/ScreenChrome";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return t.liveJustNow;
  const min = Math.floor(ms / 60000);
  if (min < 1) return t.liveJustNow;
  if (min < 60) return t.liveMinutes(min);
  return t.liveHours(Math.floor(min / 60));
}

export default function LiveUsersScreen() {
  const insets = useSafeAreaInsets();
  const { user, ready } = useAuth();
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [loaded, setLoaded] = useState(false);

  const admin = isAdmin(user?.email);

  // Guard: only the admin account may view this screen.
  useEffect(() => {
    if (ready && !admin) router.replace("/(tabs)");
  }, [ready, admin]);

  // Live subscription to the online-users presence list.
  useEffect(() => {
    if (!admin) return;
    const unsub = subscribeOnlineUsers((next) => {
      setUsers(next);
      setLoaded(true);
    });
    return unsub;
  }, [admin]);

  if (!admin) return null;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.liveUsersTitle} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: S.paddingContent, paddingBottom: insets.bottom + 40 }}
      >
        {/* Live counter */}
        <View style={s.counterCard}>
          <LinearGradient
            colors={[C.accentSoft, "transparent"]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={s.counterRow}>
            <View style={s.counterText}>
              <Text style={s.counterNum}>{users.length}</Text>
              <Text style={s.counterLabel}>{t.liveUsersNow(users.length)}</Text>
            </View>
            <View style={s.livePill}>
              <View style={s.liveDot} />
              <Text style={s.livePillText}>LIVE</Text>
            </View>
          </View>
          <Text style={s.counterSub}>{t.liveUsersSub}</Text>
        </View>

        {/* List */}
        {!loaded ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={C.accent} />
          </View>
        ) : users.length === 0 ? (
          <View style={s.emptyWrap}>
            <View style={s.emptyIcon}>
              <Ionicons name="people-outline" size={30} color={C.textMuted} />
            </View>
            <Text style={s.emptyTitle}>{t.liveUsersEmpty}</Text>
            <Text style={s.emptySub}>{t.liveUsersEmptySub}</Text>
          </View>
        ) : (
          <View style={s.list}>
            {users.map((u) => {
              const isMe = u.userId === user?.id;
              const initial = (u.name || u.email || "?").trim().charAt(0).toUpperCase();
              return (
                <View key={u.userId} style={s.row}>
                  {/* time + devices on the left (Arabic reads R→L) */}
                  <View style={s.rowMeta}>
                    <Text style={s.rowTime}>{t.liveSince(timeAgo(u.onlineAt))}</Text>
                    {u.devices > 1 ? (
                      <View style={s.deviceChip}>
                        <Ionicons name="phone-portrait-outline" size={10} color={C.textSecondary} />
                        <Text style={s.deviceText}>{u.devices}</Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={s.rowBody}>
                    <Text style={s.rowName} numberOfLines={1}>
                      {u.name}{isMe ? ` · ${t.liveUsersYou}` : ""}
                    </Text>
                    <Text style={s.rowEmail} numberOfLines={1}>{u.email}</Text>
                  </View>

                  <View style={s.avatarWrap}>
                    {u.avatarUrl ? (
                      <Image source={{ uri: u.avatarUrl }} style={s.avatar} contentFit="cover" transition={120} />
                    ) : (
                      <View style={[s.avatar, s.avatarFallback]}>
                        <Text style={s.avatarInitial}>{initial}</Text>
                      </View>
                    )}
                    <View style={s.onlineDot} />
                  </View>
                </View>
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

  counterCard: {
    borderRadius: R.xxl, padding: 18, overflow: "hidden",
    backgroundColor: C.surfaceCard, borderWidth: 1, borderColor: C.borderAccent,
    ...ELEVATION_CARD,
  },
  counterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  counterText: { alignItems: "flex-end" },
  counterNum: { color: C.text, fontSize: 40, fontWeight: "800", fontFamily: "Outfit_800ExtraBold", lineHeight: 46 },
  counterLabel: { color: C.textSecondary, fontSize: 13, marginTop: 2, fontFamily: "Cairo_600SemiBold", textAlign: "right" },
  counterSub: { color: C.textMuted, fontSize: 12, marginTop: 14, lineHeight: 18, textAlign: "right", fontFamily: "Cairo_500Medium" },

  livePill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: R.pill,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.success },
  livePillText: { color: C.accent, fontSize: 11, fontWeight: "800", fontFamily: "Outfit_800ExtraBold", letterSpacing: 1 },

  list: { marginTop: 18, gap: 8 },
  row: {
    flexDirection: "row", alignItems: "center",
    padding: 12, borderRadius: R.lg,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  rowMeta: { alignItems: "flex-start", gap: 6, minWidth: 56 },
  rowTime: { color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium" },
  deviceChip: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  deviceText: { color: C.textSecondary, fontSize: 11, fontWeight: "700", fontFamily: "Cairo_700Bold" },

  rowBody: { flex: 1, marginHorizontal: 12, alignItems: "flex-end" },
  rowName: { color: C.text, fontSize: 15, fontWeight: "700", fontFamily: "Cairo_700Bold", textAlign: "right" },
  rowEmail: { color: C.textSecondary, fontSize: 12, marginTop: 3, fontFamily: "Cairo_500Medium", textAlign: "right" },

  avatarWrap: { width: 46, height: 46 },
  avatar: { width: 46, height: 46, borderRadius: R.circle },
  avatarFallback: { backgroundColor: C.bgDeep, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.borderViolet },
  avatarInitial: { color: C.text, fontSize: 18, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  onlineDot: {
    position: "absolute", bottom: 0, right: 0,
    width: 13, height: 13, borderRadius: 7,
    backgroundColor: C.success, borderWidth: 2.5, borderColor: C.surface,
  },

  loadingWrap: { paddingVertical: 60, alignItems: "center" },
  emptyWrap: { alignItems: "center", paddingVertical: 56 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: R.circle, marginBottom: 14,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "700", fontFamily: "Cairo_700Bold" },
  emptySub: { color: C.textMuted, fontSize: 13, marginTop: 6, textAlign: "center", fontFamily: "Cairo_500Medium" },
});
