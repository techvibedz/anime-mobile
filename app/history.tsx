// Full watch history — one card per anime with the last episode reached,
// progress, episode count and per-anime delete.

import { useCallback, useState } from "react";
import { View, Text, FlatList, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Aurora, ScreenHeader } from "../components/ScreenChrome";
import { HistoryCard } from "../components/HistoryCard";
import { StateView } from "../components/StateView";
import {
  getHistoryByAnime,
  removeAnimeFromHistory,
  subscribeHistory,
  type AnimeHistoryGroup,
} from "../lib/history";
import { C, R, S } from "../lib/theme";
import { t } from "../lib/i18n";

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<AnimeHistoryGroup[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    getHistoryByAnime()
      .then((g) => {
        setGroups(g);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      return subscribeHistory(load);
    }, [load]),
  );

  const handleDelete = useCallback(
    (group: AnimeHistoryGroup) => {
      setGroups((prev) => prev.filter((g) => g.key !== group.key));
      void removeAnimeFromHistory(group.animeHref, group.animeTitle).catch(load);
    },
    [load],
  );

  const totalEpisodes = groups.reduce((n, g) => n + g.episodes, 0);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.watchHistory} />
      <FlatList
        data={groups}
        keyExtractor={(g) => g.key}
        renderItem={({ item }) => <HistoryCard group={item} onDelete={handleDelete} />}
        ListHeaderComponent={
          groups.length > 0 ? (
            <View style={s.summary}>
              <View style={s.summaryCol}>
                <Text style={s.summaryValue}>{groups.length}</Text>
                <Text style={s.summaryLabel}>{t.historyAnimeStat}</Text>
              </View>
              <View style={s.summaryDivider} />
              <View style={s.summaryCol}>
                <Text style={s.summaryValue}>{totalEpisodes}</Text>
                <Text style={s.summaryLabel}>{t.historyEpisodesStat}</Text>
              </View>
            </View>
          ) : null
        }
        ListEmptyComponent={
          loaded ? (
            <StateView icon="time-outline" title={t.historyEmptyTitle} message={t.historyEmptySub} />
          ) : null
        }
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + 40 },
          groups.length === 0 && { flexGrow: 1 },
        ]}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: S.paddingContent },

  summary: {
    flexDirection: "row", alignItems: "stretch",
    backgroundColor: C.surfaceContainer, borderRadius: R.xl,
    paddingVertical: 16, marginBottom: 18,
  },
  summaryCol: { flex: 1, alignItems: "center" },
  summaryValue: { color: C.text, fontSize: 20, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  summaryLabel: { color: C.textSecondary, fontSize: 11, marginTop: 4, fontFamily: "Cairo_500Medium" },
  summaryDivider: { width: 1, backgroundColor: C.border, marginVertical: 2 },
});
