import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../../lib/auth";
import { isAdmin } from "../../lib/presence";
import { fetchUserDaily, type DailyRow } from "../../lib/usage";
import { C, S, R, ELEVATION_CARD } from "../../lib/theme";
import { t } from "../../lib/i18n";
import { Aurora, ScreenHeader } from "../../components/ScreenChrome";

// Compact Arabic duration: ث/د/س/ي (seconds/minutes/hours/days).
function fmtDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return t.usersNever;
  if (totalSeconds < 60) return t.usersSeconds(totalSeconds);
  const min = Math.floor(totalSeconds / 60);
  if (min < 60) return t.liveMinutes(min);
  const h = Math.floor(min / 60);
  if (h < 24) {
    const rm = min % 60;
    return rm ? `${t.liveHours(h)} ${t.liveMinutes(rm)}` : t.liveHours(h);
  }
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${t.usersDays(d)} ${t.liveHours(rh)}` : t.usersDays(d);
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return t.liveJustNow;
  const min = Math.floor(ms / 60000);
  if (min < 1) return t.liveJustNow;
  if (min < 60) return t.liveMinutes(min);
  const h = Math.floor(min / 60);
  if (h < 24) return t.liveHours(h);
  return t.usersDays(Math.floor(h / 24));
}

// "YYYY-MM-DD" → اليوم / أمس / dd/mm/yyyy, using the device's local calendar.
function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return day;
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((t0.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return t.userToday;
  if (diffDays === 1) return t.userYesterday;
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${dd}/${mm}/${y}`;
}

export default function UserDetailScreen() {
  const insets = useSafeAreaInsets();
  const { user, ready } = useAuth();
  const params = useLocalSearchParams<{
    id: string;
    name?: string;
    email?: string;
    avatar?: string;
    last?: string;
  }>();
  const userId = String(params.id ?? "");
  const name = params.name || params.email || "";
  const email = params.email || "";
  const avatar = params.avatar || "";
  const lastSeen = params.last || "";

  const [days, setDays] = useState<DailyRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const admin = isAdmin(user?.email);

  useEffect(() => {
    if (ready && !admin) router.replace("/(tabs)");
  }, [ready, admin]);

  const load = useCallback(async () => {
    if (!userId) return;
    const next = await fetchUserDaily(userId);
    setDays(next);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    if (admin) load();
  }, [admin, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!admin) return null;

  const totalSeconds = days.reduce((s, d) => s + d.seconds, 0);
  const totalOpens = days.reduce((s, d) => s + d.opens, 0);
  const activeDays = days.length;
  const avgSeconds = activeDays ? Math.round(totalSeconds / activeDays) : 0;
  const maxSeconds = days.reduce((m, d) => Math.max(m, d.seconds), 0);
  const initial = (name || email || "?").trim().charAt(0).toUpperCase();

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.userDailyTitle} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: S.paddingContent, paddingBottom: insets.bottom + 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />
        }
      >
        {/* Profile header */}
        <View style={s.profileCard}>
          <LinearGradient
            colors={[C.accentSoft, "transparent"]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={s.profileBody}>
            <Text style={s.profileName} numberOfLines={1}>{name}</Text>
            <Text style={s.profileEmail} numberOfLines={1}>{email}</Text>
            {lastSeen ? (
              <Text style={s.profileLast}>{t.usersLastSeen}: {timeAgo(lastSeen)}</Text>
            ) : null}
          </View>
          <View style={s.avatarWrap}>
            {avatar ? (
              <Image source={{ uri: avatar }} style={s.avatar} contentFit="cover" transition={120} />
            ) : (
              <View style={[s.avatar, s.avatarFallback]}>
                <Text style={s.avatarInitial}>{initial}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Summary */}
        <View style={s.summary}>
          <Summary icon="time-outline" label={t.userTotalTime} value={fmtDuration(totalSeconds)} strong />
          <Summary icon="enter-outline" label={t.userTotalOpens} value={String(totalOpens)} />
          <Summary icon="calendar-outline" label={t.userActiveDays} value={String(activeDays)} />
          <Summary icon="speedometer-outline" label={t.userAvgPerDay} value={fmtDuration(avgSeconds)} />
        </View>

        {/* Daily list */}
        {!loaded ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={C.accent} />
          </View>
        ) : days.length === 0 ? (
          <View style={s.emptyWrap}>
            <View style={s.emptyIcon}>
              <Ionicons name="calendar-outline" size={30} color={C.textMuted} />
            </View>
            <Text style={s.emptyTitle}>{t.userNoDays}</Text>
            <Text style={s.emptySub}>{t.userNoDaysSub}</Text>
          </View>
        ) : (
          <View style={s.list}>
            {days.map((d) => {
              const pct = maxSeconds > 0 ? Math.max(0.06, d.seconds / maxSeconds) : 0;
              return (
                <View key={d.day} style={s.dayRow}>
                  <View style={s.dayHead}>
                    <Text style={s.dayTime} numberOfLines={1}>{fmtDuration(d.seconds)}</Text>
                    <Text style={s.dayLabel} numberOfLines={1}>{dayLabel(d.day)}</Text>
                  </View>
                  <View style={s.dayBarTrack}>
                    <View style={[s.dayBarFill, { width: `${Math.round(pct * 100)}%` }]} />
                  </View>
                  <View style={s.dayMeta}>
                    <Text style={s.dayOpens}>{t.userDayOpens(d.opens)}</Text>
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

function Summary({
  icon,
  label,
  value,
  strong,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={s.summaryCell}>
      <View style={s.summaryHead}>
        <Ionicons name={icon} size={13} color={strong ? C.accent : C.textMuted} />
        <Text style={s.summaryLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Text
        style={[s.summaryValue, strong && s.summaryValueStrong]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  profileCard: {
    flexDirection: "row", alignItems: "center",
    borderRadius: R.xxl, padding: 16, overflow: "hidden",
    backgroundColor: C.surfaceCard, borderWidth: 1, borderColor: C.borderAccent,
    ...ELEVATION_CARD,
  },
  profileBody: { flex: 1, marginRight: 14, alignItems: "flex-end" },
  profileName: { color: C.text, fontSize: 18, fontWeight: "800", fontFamily: "Cairo_700Bold", textAlign: "right" },
  profileEmail: { color: C.textSecondary, fontSize: 12.5, marginTop: 3, fontFamily: "Cairo_500Medium", textAlign: "right" },
  profileLast: { color: C.textMuted, fontSize: 11.5, marginTop: 8, fontFamily: "Cairo_500Medium", textAlign: "right" },

  avatarWrap: { width: 60, height: 60 },
  avatar: { width: 60, height: 60, borderRadius: R.circle },
  avatarFallback: { backgroundColor: C.bgDeep, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.borderViolet },
  avatarInitial: { color: C.text, fontSize: 24, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },

  summary: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between",
    marginTop: 12,
  },
  summaryCell: {
    width: "48.5%", marginBottom: 9,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: R.lg, paddingVertical: 12, paddingHorizontal: 12,
    alignItems: "flex-end",
    ...ELEVATION_CARD,
  },
  summaryHead: { flexDirection: "row-reverse", alignItems: "center" },
  summaryLabel: { color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium", marginRight: 5 },
  summaryValue: { color: C.text, fontSize: 17, fontWeight: "800", fontFamily: "Cairo_700Bold", marginTop: 5, textAlign: "right", alignSelf: "stretch" },
  summaryValueStrong: { color: C.accent },

  list: { marginTop: 8, gap: 8 },
  dayRow: {
    padding: 14, borderRadius: R.lg,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  dayHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dayTime: { color: C.accent, fontSize: 14, fontWeight: "800", fontFamily: "Cairo_700Bold" },
  dayLabel: { color: C.text, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_700Bold", textAlign: "right" },
  dayBarTrack: {
    height: 6, borderRadius: R.pill, marginTop: 10, overflow: "hidden",
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  dayBarFill: { height: "100%", borderRadius: R.pill, backgroundColor: C.accent },
  dayMeta: { marginTop: 8, alignItems: "flex-end" },
  dayOpens: { color: C.textMuted, fontSize: 11.5, fontFamily: "Cairo_500Medium" },

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
