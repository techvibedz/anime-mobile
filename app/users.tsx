import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  TextInput,
} from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../lib/auth";
import { isAdmin, subscribeOnlineUsers, type OnlineUser } from "../lib/presence";
import { fetchAllUsage, type UsageRow } from "../lib/usage";
import { C, S, R, ELEVATION_CARD } from "../lib/theme";
import { t } from "../lib/i18n";
import { Aurora, ScreenHeader } from "../components/ScreenChrome";

type FilterKey = "all" | "online" | "active" | "inactive";
type SortKey = "recent" | "time" | "sessions";

// "منذ ..." relative time, extended past the live screen's hours to days.
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

// Compact Arabic duration: ث/د/س/ي (seconds/minutes/hours/days).
function fmtDuration(totalSeconds: number): string {
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

function fmtDate(iso: string | null): string {
  if (!iso) return t.usersNever;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return t.usersNever;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default function UsersScreen() {
  const insets = useSafeAreaInsets();
  const { user, ready } = useAuth();
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("recent");

  const admin = isAdmin(user?.email);

  // Guard: only the admin account may view this screen.
  useEffect(() => {
    if (ready && !admin) router.replace("/(tabs)");
  }, [ready, admin]);

  const load = useCallback(async () => {
    const next = await fetchAllUsage();
    setRows(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!admin) return;
    load();
  }, [admin, load]);

  // Cross-reference live presence to flag who's online right now.
  useEffect(() => {
    if (!admin) return;
    const unsub = subscribeOnlineUsers((users: OnlineUser[]) => {
      setOnlineIds(new Set(users.map((u) => u.userId)));
    });
    return unsub;
  }, [admin]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Apply search + filter + sort. Memoised so typing stays smooth on 100s of users.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) {
        return false;
      }
      if (filter === "online") return onlineIds.has(r.userId);
      if (filter === "active") return r.totalSeconds > 0;
      if (filter === "inactive") return r.totalSeconds === 0;
      return true;
    });
    out = [...out].sort((a, b) => {
      if (sort === "time") return b.totalSeconds - a.totalSeconds;
      if (sort === "sessions") return b.sessions - a.sessions;
      // recent: newest last-seen first
      return (a.lastSeenAt < b.lastSeenAt ? 1 : -1);
    });
    return out;
  }, [rows, query, filter, sort, onlineIds]);

  const renderUser = useCallback(({ item }: { item: UsageRow }) => (
    <UserRow item={item} isMe={item.userId === user?.id} online={onlineIds.has(item.userId)} />
  ), [user?.id, onlineIds]);

  if (!admin) return null;

  const totalTime = rows.reduce((sum, r) => sum + r.totalSeconds, 0);
  const filtering = query.trim().length > 0 || filter !== "all";

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.usersTitle} />

      <FlatList
        data={loaded ? filtered : []}
        keyExtractor={(item) => item.userId}
        renderItem={renderUser}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: S.paddingContent, paddingBottom: insets.bottom + 40 }}
        removeClippedSubviews
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={7}
        updateCellsBatchingPeriod={50}
        ItemSeparatorComponent={() => <View style={s.separator} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />
        }
        ListHeaderComponent={(
          <>
            <View style={s.counterCard}>
              <LinearGradient
                colors={[C.accentSoft, "transparent"]}
                start={{ x: 1, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={s.counterRow}>
                <View style={s.counterText}>
                  <Text style={s.counterNum}>{rows.length}</Text>
                  <Text style={s.counterLabel}>{t.usersCount(rows.length)}</Text>
                </View>
                <View style={s.totalPill}>
                  <Ionicons name="time-outline" size={13} color={C.accent} />
                  <Text style={s.totalPillText}>{fmtDuration(totalTime)}</Text>
                </View>
              </View>
              <Text style={s.counterSub}>{t.usersSub}</Text>
            </View>

            <View style={s.controls}>
              <View style={s.searchBox}>
                <Ionicons name="search" size={16} color={C.textMuted} />
                <TextInput
                  style={s.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t.usersSearchPlaceholder}
                  placeholderTextColor={C.textMuted}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="search"
                />
                {query.length > 0 ? (
                  <Pressable onPress={() => setQuery("")} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={C.textMuted} />
                  </Pressable>
                ) : null}
              </View>

              <View style={s.chipRow}>
                <Chip label={t.usersFilterAll} active={filter === "all"} onPress={() => setFilter("all")} />
                <Chip label={t.usersFilterOnline} icon="ellipse" active={filter === "online"} onPress={() => setFilter("online")} accent={C.success} />
                <Chip label={t.usersFilterActive} active={filter === "active"} onPress={() => setFilter("active")} />
                <Chip label={t.usersFilterInactive} active={filter === "inactive"} onPress={() => setFilter("inactive")} />
              </View>

              <View style={s.chipRow}>
                <Text style={s.sortLabel}>{t.usersSortBy}</Text>
                <Chip label={t.usersSortRecent} active={sort === "recent"} onPress={() => setSort("recent")} small />
                <Chip label={t.usersSortTime} active={sort === "time"} onPress={() => setSort("time")} small />
                <Chip label={t.usersSortSessions} active={sort === "sessions"} onPress={() => setSort("sessions")} small />
              </View>
            </View>
            {filtering ? (
              <Text style={s.resultCount}>{t.usersShowing(filtered.length, rows.length)}</Text>
            ) : null}
            <View style={s.listStart} />
          </>
        )}
        ListEmptyComponent={(
          !loaded ? (
            <View style={s.loadingWrap}><ActivityIndicator size="large" color={C.accent} /></View>
          ) : rows.length === 0 ? (
            <EmptyState icon="stats-chart-outline" title={t.usersEmpty} subtitle={t.usersEmptySub} />
          ) : (
            <EmptyState icon="search-outline" title={t.usersNoMatch} subtitle={t.usersNoMatchSub} />
          )
        )}
      />
    </View>
  );
}

const UserRow = memo(function UserRow({
  item: u,
  isMe,
  online,
}: {
  item: UsageRow;
  isMe: boolean;
  online: boolean;
}) {
  const initial = (u.name || u.email || "?").trim().charAt(0).toUpperCase();
  return (
    <Pressable
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
      onPress={() => router.push({
        pathname: "/user/[id]",
        params: {
          id: u.userId,
          name: u.name,
          email: u.email,
          avatar: u.avatarUrl ?? "",
          last: u.lastSeenAt,
        },
      })}
    >
      <View style={s.rowHead}>
        <Ionicons name="chevron-back" size={18} color={C.textMuted} style={s.rowChevron} />
        <View style={s.rowBody}>
          <Text style={s.rowName} numberOfLines={1}>{u.name}{isMe ? ` · ${t.liveUsersYou}` : ""}</Text>
          <Text style={s.rowEmail} numberOfLines={1}>{u.email}</Text>
          {online ? (
            <View style={s.onlinePill}>
              <View style={s.onlinePillDot} />
              <Text style={s.onlinePillText}>{t.usersOnlineNow}</Text>
            </View>
          ) : null}
        </View>
        <View style={s.avatarWrap}>
          {u.avatarUrl ? (
            <Image
              source={{ uri: u.avatarUrl }}
              style={s.avatar}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={u.userId}
              transition={120}
            />
          ) : (
            <View style={[s.avatar, s.avatarFallback]}><Text style={s.avatarInitial}>{initial}</Text></View>
          )}
          {online ? <View style={s.onlineDot} /> : null}
        </View>
      </View>
      <View style={s.stats}>
        <Stat icon="time-outline" label={t.usersTimeSpent} value={u.totalSeconds > 0 ? fmtDuration(u.totalSeconds) : t.usersNever} strong />
        <Stat icon="enter-outline" label={t.usersLastSeen} value={timeAgo(u.lastSeenAt)} />
        <Stat icon="repeat-outline" label={t.usersSessions} value={String(u.sessions)} />
        <Stat icon="calendar-outline" label={t.usersRegistered} value={fmtDate(u.createdAt)} />
        <Stat icon="phone-portrait-outline" label={t.usersVersion} value={u.version ? `v${u.version}` : t.usersNever} />
        <Stat icon="play-outline" label={t.usersEpisodesStarted} value={String(u.episodesStarted)} />
        <Stat icon="checkmark-circle-outline" label={t.usersEpisodesCompleted} value={String(u.episodesCompleted)} strong />
      </View>
    </Pressable>
  );
});

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
}) {
  return (
    <View style={s.emptyWrap}>
      <View style={s.emptyIcon}><Ionicons name={icon} size={30} color={C.textMuted} /></View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptySub}>{subtitle}</Text>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  icon,
  accent,
  small,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  accent?: string;
  small?: boolean;
}) {
  const tint = accent ?? C.accent;
  return (
    <Pressable
      onPress={onPress}
      style={[s.chip, small && s.chipSmall, active && s.chipActive, active && { borderColor: tint }]}
    >
      {icon ? (
        <Ionicons name={icon} size={9} color={active ? tint : C.textMuted} style={s.chipIcon} />
      ) : null}
      <Text style={[s.chipText, small && s.chipTextSmall, active && { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

function Stat({
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
    <View style={s.stat}>
      <View style={s.statHead}>
        <Ionicons name={icon} size={13} color={strong ? C.accent : C.textMuted} />
        <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
      </View>
      <Text
        style={[s.statValue, strong && s.statValueStrong]}
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

  totalPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: R.pill,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
  },
  totalPillText: { color: C.accent, fontSize: 13, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },

  controls: { marginTop: 14 },
  searchBox: {
    flexDirection: "row-reverse", alignItems: "center",
    paddingHorizontal: 14, height: 46, borderRadius: R.lg,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  searchInput: {
    flex: 1, color: C.text, fontSize: 14, fontFamily: "Cairo_500Medium",
    textAlign: "right", marginHorizontal: 10, paddingVertical: 0,
  },
  chipRow: { flexDirection: "row-reverse", flexWrap: "wrap", alignItems: "center", marginTop: 10 },
  sortLabel: { color: C.textMuted, fontSize: 11.5, fontFamily: "Cairo_500Medium", marginLeft: 8, marginBottom: 8 },
  chip: {
    flexDirection: "row-reverse", alignItems: "center",
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    marginLeft: 8, marginBottom: 8,
  },
  chipSmall: { paddingHorizontal: 11, paddingVertical: 6 },
  chipActive: { backgroundColor: C.accentSoft },
  chipIcon: { marginLeft: 5 },
  chipText: { color: C.textSecondary, fontSize: 12.5, fontWeight: "700", fontFamily: "Cairo_700Bold" },
  chipTextSmall: { fontSize: 11.5 },

  resultCount: { color: C.textMuted, fontSize: 12, fontFamily: "Cairo_500Medium", textAlign: "right", marginBottom: 4 },

  listStart: { height: 18 },
  separator: { height: 10 },
  row: {
    padding: 14, borderRadius: R.lg,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  rowPressed: { opacity: 0.6 },
  rowChevron: { marginRight: 2 },
  rowHead: { flexDirection: "row", alignItems: "center" },
  rowBody: { flex: 1, marginRight: 12, alignItems: "flex-end" },
  rowName: { color: C.text, fontSize: 15, fontWeight: "700", fontFamily: "Cairo_700Bold", textAlign: "right" },
  rowEmail: { color: C.textSecondary, fontSize: 12, marginTop: 3, fontFamily: "Cairo_500Medium", textAlign: "right" },

  onlinePill: {
    flexDirection: "row", alignItems: "center", gap: 5, marginTop: 7,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  onlinePillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  onlinePillText: { color: C.success, fontSize: 10, fontWeight: "700", fontFamily: "Cairo_700Bold" },

  avatarWrap: { width: 46, height: 46 },
  avatar: { width: 46, height: 46, borderRadius: R.circle },
  avatarFallback: { backgroundColor: C.bgDeep, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.borderViolet },
  avatarInitial: { color: C.text, fontSize: 18, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  onlineDot: {
    position: "absolute", bottom: 0, right: 0,
    width: 13, height: 13, borderRadius: 7,
    backgroundColor: C.success, borderWidth: 2.5, borderColor: C.surface,
  },

  stats: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between",
    marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  // 2-per-row cells: each value (incl. dates) gets ~half the card width, so it
  // no longer overflows the way the old 4-column row did.
  stat: {
    width: "48.5%", marginBottom: 9,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: R.lg, paddingVertical: 9, paddingHorizontal: 11,
    alignItems: "flex-end",
  },
  statHead: { flexDirection: "row-reverse", alignItems: "center" },
  statLabel: { color: C.textMuted, fontSize: 10.5, fontFamily: "Cairo_500Medium", marginRight: 5 },
  statValue: {
    color: C.text, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_700Bold",
    marginTop: 4, textAlign: "right", alignSelf: "stretch",
  },
  statValueStrong: { color: C.accent },

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
