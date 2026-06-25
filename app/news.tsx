// Anime News — an infinitely-scrolling, 100% SFW feed of MAL news for the
// season's airing titles. Brand safety is enforced in lib/news.ts (query-level
// sfw=true + a second genre/keyword guard); this screen only renders what
// survives both. Tapping a card opens the full article in the browser.

import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, FlatList, RefreshControl, ActivityIndicator, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { fetchNewsPage, resetNews, type NewsItem } from "../lib/news";
import { C, R, S, AR, F, ELEVATION_CARD } from "../lib/theme";
import { t } from "../lib/i18n";
import { Aurora, ScreenHeader, OfflineNotice } from "../components/ScreenChrome";
import { useOnlineStatus } from "../lib/net";

export default function NewsScreen() {
  const insets = useSafeAreaInsets();
  const { online } = useOnlineStatus();
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageRef = useRef(0);
  const hasMoreRef = useRef(true);
  const seenIds = useRef<Set<number>>(new Set());

  const append = useCallback((batch: NewsItem[]) => {
    const fresh = batch.filter((n) => !seenIds.current.has(n.id));
    fresh.forEach((n) => seenIds.current.add(n.id));
    setItems((prev) => [...(prev ?? []), ...fresh]);
  }, []);

  const loadFirst = useCallback(async () => {
    pageRef.current = 0;
    hasMoreRef.current = true;
    seenIds.current.clear();
    setItems(null);
    try {
      const { items: batch, hasMore } = await fetchNewsPage(0);
      hasMoreRef.current = hasMore;
      seenIds.current = new Set(batch.map((n) => n.id));
      setItems(batch);
    } catch {
      setItems([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMoreRef.current || items === null) return;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const { items: batch, hasMore } = await fetchNewsPage(next);
      pageRef.current = next;
      hasMoreRef.current = hasMore;
      append(batch);
    } catch {
      hasMoreRef.current = false;
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, items, append]);

  useEffect(() => { loadFirst(); }, [loadFirst]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    resetNews();
    loadFirst();
  }, [loadFirst]);

  const openArticle = useCallback((n: NewsItem) => {
    router.push(`/news/${n.id}`);
  }, []);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.newsTitle} />

      {items === null ? (
        <View style={s.center}><ActivityIndicator size="large" color={C.accent} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={6}
          maxToRenderPerBatch={5}
          windowSize={7}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          contentContainerStyle={{ paddingHorizontal: S.paddingContent, paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={<Text style={s.intro}>{t.newsSub}</Text>}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.surface} />
          }
          ListEmptyComponent={<OfflineNotice offline={online === false} onRetry={onRefresh} />}
          ListFooterComponent={
            loadingMore ? <View style={s.footer}><ActivityIndicator color={C.accent} /></View> : null
          }
          renderItem={({ item }) => <NewsCard item={item} onPress={openArticle} />}
        />
      )}
    </View>
  );
}

/* ── NewsCard ──────────────────────────────────────
 * Edge-to-edge thumbnail under an ink gradient (keeps the headline legible over
 * any image), then a meta row (source chip · time-ago), a bold Cairo headline
 * and a two-line excerpt — SUMI ink surface, ember hairline, soft black lift. */
function NewsCard({ item, onPress }: { item: NewsItem; onPress: (n: NewsItem) => void }) {
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
    >
      {item.image ? (
        <View style={s.thumbWrap}>
          <Image source={{ uri: item.image }} style={s.thumb} contentFit="cover" transition={150} />
          <LinearGradient
            colors={["transparent", "rgba(10,10,11,0.35)", C.surface]}
            locations={[0, 0.6, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={s.thumbTag}>
            <Ionicons name="newspaper" size={11} color={C.ember} />
            <Text style={s.thumbTagText} numberOfLines={1}>{item.animeTitle}</Text>
          </View>
        </View>
      ) : null}

      <View style={s.body}>
        <View style={s.meta}>
          <Text style={s.metaTime}>{t.newsTimeAgo(item.date)}</Text>
          {!item.image ? (
            <Text style={s.metaSource} numberOfLines={1}>{t.newsSource(item.animeTitle)}</Text>
          ) : null}
        </View>
        <Text style={s.headline} numberOfLines={3}>{item.title}</Text>
        {item.excerpt ? <Text style={s.excerpt} numberOfLines={2}>{item.excerpt}</Text> : null}
        <View style={s.readRow}>
          <Text style={s.readText}>{t.newsRead}</Text>
          <Ionicons name="arrow-back" size={14} color={C.ember} />
        </View>
      </View>
      <View style={s.edge} pointerEvents="none" />
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  footer: { paddingVertical: 22, alignItems: "center" },
  intro: {
    color: C.textSecondary, fontSize: 12.5, lineHeight: 20, textAlign: "right",
    fontFamily: AR.medium, marginBottom: 16, marginTop: 2,
  },

  card: {
    borderRadius: R.xl, marginBottom: 16, overflow: "hidden",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  cardPressed: { transform: [{ scale: 0.99 }], borderColor: C.borderAccent },

  thumbWrap: { height: 168, backgroundColor: C.surfaceLight },
  thumb: { width: "100%", height: "100%" },
  thumbTag: {
    position: "absolute", top: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 6,
    maxWidth: "70%", paddingHorizontal: 10, paddingVertical: 5, borderRadius: R.pill,
    backgroundColor: C.overlayMedium, borderWidth: 1, borderColor: C.borderAccent,
  },
  thumbTagText: { color: C.bone, fontSize: 11, fontFamily: F.bodySemi },

  body: { padding: 15 },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10, marginBottom: 8 },
  metaTime: { color: C.ember, fontSize: 11, fontFamily: AR.semibold },
  metaSource: { color: C.textMuted, fontSize: 11, fontFamily: AR.medium, flexShrink: 1 },

  headline: { color: C.bone, fontSize: 16, lineHeight: 24, fontFamily: AR.bold, textAlign: "right" },
  excerpt: { color: C.textSecondary, fontSize: 12.5, lineHeight: 20, fontFamily: AR.medium, textAlign: "right", marginTop: 7 },

  readRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, marginTop: 12 },
  readText: { color: C.ember, fontSize: 12.5, fontFamily: AR.bold },

  // Ember hairline pinned to the reading (right) edge — the SUMI accent tick.
  edge: { position: "absolute", top: 0, bottom: 0, right: 0, width: 2.5, backgroundColor: C.ember, opacity: 0.5 },
});
