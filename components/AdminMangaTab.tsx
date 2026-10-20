// Admin users screen → "المانجا" tab: which manga each user reads. Data comes
// from the admin-only RPCs (lib/adminManga), mirrored from devices by
// lib/manga/cloud. A user row expands inline to their titles, newest first.

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator, RefreshControl, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { fetchAdminMangaSummary, fetchAdminUserManga, type AdminMangaEntry, type AdminMangaSummary } from "../lib/adminManga";
import type { UsageRow } from "../lib/usage";
import { posterUrl } from "../lib/img";
import { C, R, S } from "../lib/theme";
import { t } from "../lib/i18n";

type Row = AdminMangaSummary & { name: string; email: string; avatarUrl: string | null };

function ago(iso: string | null): string {
  if (!iso) return "";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!(min >= 1)) return t.liveJustNow;
  if (min < 60) return t.liveMinutes(min);
  const h = Math.floor(min / 60);
  if (h < 24) return t.liveHours(h);
  return t.usersDays(Math.floor(h / 24));
}

export function AdminMangaTab({ users, bottomPad }: { users: UsageRow[]; bottomPad: number }) {
  const [summary, setSummary] = useState<AdminMangaSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => setSummary(await fetchAdminMangaSummary()), []);
  useEffect(() => { void load(); }, [load]);

  const rows: Row[] = useMemo(() => {
    const byId = new Map(users.map((u) => [u.userId, u]));
    return (summary ?? [])
      .map((m) => {
        const u = byId.get(m.userId);
        return { ...m, name: u?.name || u?.email || "—", email: u?.email || "", avatarUrl: u?.avatarUrl ?? null };
      })
      .sort((a, b) => ((a.lastReadAt ?? "") < (b.lastReadAt ?? "") ? 1 : -1));
  }, [summary, users]);

  const totalTitles = rows.reduce((n, r) => n + r.mangaCount, 0);

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.userId}
      contentContainerStyle={{ padding: S.paddingContent, paddingBottom: bottomPad + 40 }}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListHeaderComponent={(
        <View style={st.counter}>
          <Text style={st.counterNum}>{rows.length}</Text>
          <Text style={st.counterLabel}>{t.adminMangaReaders(rows.length, totalTitles)}</Text>
        </View>
      )}
      ListEmptyComponent={summary === null
        ? <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
        : (
          <View style={st.empty}>
            <Ionicons name="book-outline" size={30} color={C.textMuted} />
            <Text style={st.emptyTitle}>{t.adminMangaEmpty}</Text>
            <Text style={st.emptySub}>{t.adminMangaEmptySub}</Text>
          </View>
        )}
      renderItem={({ item }) => (
        <ReaderRow item={item} open={open === item.userId} onToggle={() => setOpen((cur) => (cur === item.userId ? null : item.userId))} />
      )}
    />
  );
}

const ReaderRow = memo(function ReaderRow({ item, open, onToggle }: { item: Row; open: boolean; onToggle: () => void }) {
  const [entries, setEntries] = useState<AdminMangaEntry[] | null>(null);
  useEffect(() => {
    if (!open || entries) return;
    fetchAdminUserManga(item.userId).then(setEntries).catch(() => setEntries([]));
  }, [open, entries, item.userId]);
  const initial = (item.name || "?").trim().charAt(0).toUpperCase();
  return (
    <View style={st.card}>
      <Pressable onPress={onToggle} style={({ pressed }) => [st.head, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        {item.avatarUrl
          ? <Image source={{ uri: item.avatarUrl }} style={st.avatar} contentFit="cover" />
          : <View style={[st.avatar, st.avatarFallback]}><Text style={st.initial}>{initial}</Text></View>}
        <View style={st.headBody}>
          <Text style={st.name} numberOfLines={1}>{item.name}</Text>
          <Text style={st.meta} numberOfLines={1}>
            {t.adminMangaUserMeta(item.mangaCount, item.readingCount)}{item.lastReadAt ? ` · ${ago(item.lastReadAt)}` : ""}
          </Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={C.textMuted} />
      </Pressable>
      {open && (
        entries === null
          ? <ActivityIndicator color={C.accent} style={{ marginVertical: 14 }} />
          : entries.map((e) => <MangaLine key={e.key} e={e} />)
      )}
    </View>
  );
});

function MangaLine({ e }: { e: AdminMangaEntry }) {
  const pct = e.total > 0 ? Math.min(1, (e.page + 1) / e.total) : 0;
  return (
    <View style={st.line}>
      {e.cover
        ? <Image source={{ uri: posterUrl(e.cover, 48) }} style={st.cover} contentFit="cover" cachePolicy="memory-disk" />
        : <View style={[st.cover, st.coverFallback]}><Ionicons name="book-outline" size={16} color={C.textMuted} /></View>}
      <View style={st.lineBody}>
        <Text style={st.lineTitle} numberOfLines={2}>{e.title || e.key}</Text>
        <View style={st.lineMetaRow}>
          {e.inLibrary ? <View style={st.libPill}><Ionicons name="bookmark" size={10} color={C.accent} /><Text style={st.libText}>{t.adminMangaInLibrary}</Text></View> : null}
          <Text style={st.lineMeta}>
            {e.chapterNumber ? `${t.adminMangaChapter} ${e.chapterNumber}${e.total > 0 ? ` · ${Math.min(e.page + 1, e.total)}/${e.total}` : ""}` : t.adminMangaNotStarted}
            {` · ${ago(e.updatedAt)}`}
          </Text>
        </View>
        {e.chapterNumber && e.total > 0 ? (
          <View style={st.track}><View style={[st.fill, { width: `${Math.round(pct * 100)}%` }]} /></View>
        ) : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  counter: { padding: 22, borderRadius: R.lg, backgroundColor: C.surfaceContainer, alignItems: "flex-end", marginBottom: 18 },
  counterNum: { color: C.text, fontSize: 32, lineHeight: 40, fontFamily: "Outfit_800ExtraBold" },
  counterLabel: { color: C.textSecondary, fontSize: 13, marginTop: 2, fontFamily: "Cairo_600SemiBold", textAlign: "right" },
  empty: { alignItems: "center", paddingVertical: 50, gap: 8 },
  emptyTitle: { color: C.text, fontSize: 15, fontFamily: "Cairo_700Bold" },
  emptySub: { color: C.textMuted, fontSize: 12, lineHeight: 20, fontFamily: "Cairo_500Medium", textAlign: "center", maxWidth: 280 },
  card: { borderRadius: R.lg, backgroundColor: C.surfaceContainer, paddingHorizontal: 16, paddingVertical: 6 },
  head: { flexDirection: "row-reverse", alignItems: "center", paddingVertical: 10 },
  avatar: { width: 44, height: 44, borderRadius: R.circle },
  avatarFallback: { backgroundColor: C.bgDeep, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.borderViolet },
  initial: { color: C.text, fontSize: 17, fontFamily: "Outfit_800ExtraBold" },
  headBody: { flex: 1, alignItems: "flex-end", marginHorizontal: 12 },
  name: { color: C.text, fontSize: 15, fontFamily: "Cairo_700Bold", textAlign: "right" },
  meta: { color: C.textSecondary, fontSize: 12, marginTop: 2, fontFamily: "Cairo_500Medium", textAlign: "right" },
  line: { flexDirection: "row-reverse", paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  cover: { width: 44, height: 64, borderRadius: 6, backgroundColor: C.surface },
  coverFallback: { alignItems: "center", justifyContent: "center" },
  lineBody: { flex: 1, alignItems: "flex-end", marginRight: 12 },
  lineTitle: { color: C.text, fontSize: 13.5, lineHeight: 21, fontFamily: "Cairo_600SemiBold", textAlign: "right" },
  lineMetaRow: { flexDirection: "row-reverse", alignItems: "center", flexWrap: "wrap", marginTop: 3 },
  libPill: { flexDirection: "row-reverse", alignItems: "center", paddingHorizontal: 7, paddingVertical: 2, borderRadius: R.pill, backgroundColor: C.accentSoft, marginLeft: 6 },
  libText: { color: C.accent, fontSize: 10, fontFamily: "Cairo_600SemiBold", marginRight: 3 },
  lineMeta: { color: C.textMuted, fontSize: 11.5, fontFamily: "Cairo_500Medium", textAlign: "right" },
  track: { height: 3, alignSelf: "stretch", backgroundColor: C.glass, borderRadius: 2, marginTop: 7, alignItems: "flex-end" },
  fill: { height: 3, backgroundColor: C.accent, borderRadius: 2 },
});
