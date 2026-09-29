// Weekly schedule — "what new episode airs each day this week".
//
// Data comes from Witanime's own schedule page (lib/schedule): every row already
// carries a real poster and a playable /anime/<slug> link, so a tap opens the
// anime's detail page directly. Witanime lists no air times, so rows show the
// episode + format instead of a clock.
//
// RTL note (RN 0.81 / Expo 54): rows are plain "row"; the poster hugs the right
// (reading) edge via marginLeft and the text body flows to its left — the same
// pattern the notifications screen uses. No row-reverse, no gap on flex rows.

import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { fetchWeeklySchedule, type ScheduleDay, type ScheduleItem } from "../lib/schedule";
import { C, S, R, ELEVATION_CARD } from "../lib/theme";
import { t } from "../lib/i18n";
import { Aurora, ScreenHeader } from "../components/ScreenChrome";
import { MalScoreBadge, useMalRating } from "../components/MalRating";

// Local day index (0 = Sunday) for "today", used to highlight the rail.
function todayWeekday(): number {
  return new Date().getDay();
}

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState<ScheduleDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(0); // index into days (0 = today)

  const load = useCallback(async (force = false) => {
    try {
      const data = await fetchWeeklySchedule(force);
      setDays(data);
    } catch {
      setDays([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  const today = todayWeekday();
  const activeDay = days[selected];
  const activeItems = activeDay?.items;

  const openItem = useCallback((item: ScheduleItem) => {
    if (item.sourceHref) router.push(`/anime/${encodeURIComponent(item.sourceHref)}`);
    else router.push(`/(tabs)/search?q=${encodeURIComponent(item.title)}`);
  }, []);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.scheduleTitle} />

      {/* Day rail — today first, then the next six days. */}
      <View style={s.railWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.rail}
        >
          {days.map((d, i) => {
            const active = i === selected;
            const isToday = d.weekday === today && i === 0;
            return (
              <Pressable key={d.dayStart} onPress={() => setSelected(i)} style={s.dayPillWrap}>
                <View style={[s.dayPill, active && s.dayPillActive]}>
                  {active && (
                    <LinearGradient
                      colors={[C.accent, C.violet]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                  )}
                  <Text style={[s.dayName, active && s.dayTextActive]}>
                    {isToday ? t.scheduleToday : t.weekdaysShort[d.weekday]}
                  </Text>
                  <Text style={[s.dayNum, active && s.dayTextActive]}>
                    {new Date(d.dayStart * 1000).getDate()}
                  </Text>
                  {!active && d.items.length > 0 && (
                    <View style={s.dayDot} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.accent} />
        </View>
      ) : days.length === 0 ? (
        <View style={s.center}>
          <View style={s.emptyIcon}>
            <Ionicons name="cloud-offline-outline" size={34} color={C.accent} />
          </View>
          <Text style={s.emptyTitle}>{t.scheduleError}</Text>
          <Text style={s.emptySub}>{t.scheduleErrorSub}</Text>
          <Pressable style={s.retryBtn} onPress={() => { setLoading(true); load(true); }}>
            <Ionicons name="refresh" size={15} color={C.textOnAccent} />
            <Text style={s.retryText}>{t.retry}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={activeItems ?? []}
          keyExtractor={(item) => String(item.id)}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: S.paddingContent, paddingBottom: insets.bottom + 30, gap: 10 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.accent}
              colors={[C.accent]}
              progressBackgroundColor={C.surface}
            />
          }
          ListHeaderComponent={
            <View style={s.listHead}>
              <Text style={s.listHeadTitle}>
                {activeDay ? t.weekdaysLong[activeDay.weekday] : ""}
              </Text>
              <Text style={s.listHeadCount}>
                {t.scheduleCount(activeItems?.length ?? 0)}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={s.dayEmpty}>
              <View style={s.emptyIcon}>
                <Ionicons name="calendar-clear-outline" size={30} color={C.textMuted} />
              </View>
              <Text style={s.emptyTitle}>{t.scheduleEmptyDay}</Text>
              <Text style={s.emptySub}>{t.scheduleEmptyDaySub}</Text>
            </View>
          }
          renderItem={({ item }) => <ScheduleRow item={item} onPress={openItem} />}
        />
      )}
    </View>
  );
}

function ScheduleRow({ item, onPress }: { item: ScheduleItem; onPress: (i: ScheduleItem) => void }) {
  const malScore = useMalRating(item.title);
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
    >
      <View style={s.body}>
        <Text style={s.epBadge}>{t.scheduleEpisode(item.episode)}</Text>
        <Text style={s.title} numberOfLines={2}>{item.title}</Text>
        <View style={s.metaRow}>
          {item.format ? <Text style={s.metaText}>{item.format}</Text> : null}
          {malScore == null && item.score != null ? (
            <View style={s.scorePill}>
              <Ionicons name="star" size={9} color={C.gold} />
              <Text style={s.scoreText}>{item.score}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={s.posterWrap}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={s.poster} contentFit="cover" cachePolicy="memory-disk" transition={150} />
        ) : (
          <View style={[s.poster, s.posterFallback]}>
            <Ionicons name="film-outline" size={20} color={C.textMuted} />
          </View>
        )}
        <MalScoreBadge score={malScore} />
      </View>
    </Pressable>
  );
}

const POSTER_W = 80;
const POSTER_H = 112;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },

  // Day rail
  railWrap: { paddingBottom: 8 },
  rail: { paddingHorizontal: S.paddingContent, gap: 8 },
  dayPillWrap: {},
  dayPill: {
    width: 64, minHeight: 88, paddingVertical: 14, borderRadius: R.md,
    alignItems: "center", justifyContent: "center", gap: 4,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderSoft,
    overflow: "hidden",
  },
  dayPillActive: { borderColor: "transparent" },
  dayName: { color: C.textSecondary, fontSize: 11, fontFamily: "Cairo_600SemiBold" },
  dayNum: { color: C.text, fontSize: 24, fontFamily: "Outfit_700Bold", fontWeight: "700" },
  dayTextActive: { color: C.textOnAccent },
  dayDot: {
    position: "absolute", bottom: 6, width: 5, height: 5, borderRadius: 3,
    backgroundColor: C.accent,
  },

  // List header (selected-day label + count)
  listHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 14,
  },
  listHeadTitle: { color: C.text, fontSize: 18, fontFamily: "Cairo_700Bold" },
  listHeadCount: {
    color: C.accent, fontSize: 12, fontFamily: "Cairo_600SemiBold",
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
    borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 3,
    overflow: "hidden",
  },

  // Row card — poster on the right, body flows left, time chip far left.
  card: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.borderSoft,
    overflow: "hidden",
  },
  cardPressed: { backgroundColor: C.surfaceLight, transform: [{ scale: 0.99 }] },

  body: { flex: 1, justifyContent: "center", marginRight: 12 },
  epBadge: { color: C.accent, fontSize: 11, fontFamily: "Cairo_700Bold", textAlign: "right" },
  title: {
    color: C.text, fontSize: 16, lineHeight: 26, fontFamily: "Cairo_600SemiBold",
    textAlign: "right", marginTop: 3,
  },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 5 },
  metaText: { color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium" },
  scorePill: { flexDirection: "row", alignItems: "center", gap: 3 },
  scoreText: { color: C.gold, fontSize: 11, fontWeight: "700", fontFamily: "Outfit_700Bold" },

  posterWrap: { width: POSTER_W, height: POSTER_H, borderRadius: R.md, overflow: "hidden" },
  poster: { width: "100%", height: "100%" },
  posterFallback: { backgroundColor: C.surfaceLight, alignItems: "center", justifyContent: "center" },

  // Empty / error states
  dayEmpty: { alignItems: "center", justifyContent: "center", paddingTop: 60, gap: 12 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "700", fontFamily: "Cairo_700Bold", textAlign: "center" },
  emptySub: {
    color: C.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center", maxWidth: 260,
    fontFamily: "Cairo_500Medium", writingDirection: "rtl",
  },
  retryBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4,
    backgroundColor: C.accent, borderRadius: R.pill, paddingVertical: 11, paddingHorizontal: 24,
  },
  retryText: { color: C.textOnAccent, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_700Bold" },
});
