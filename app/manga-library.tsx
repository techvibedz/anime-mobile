import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { M, MT } from "../lib/manga/design";
import { t } from "../lib/i18n";
import { removeFromMangaLibrary, useMangaLibrary, useContinueReading } from "../lib/manga/store";
import type { MangaCard } from "../lib/manga/types";
import { normFuzzy } from "../lib/fuzzy";
import { useCardLayout } from "../lib/cardLayout";
import { MangaGrid } from "../components/MangaGrid";
import { MangaLayoutControl, MangaState } from "../components/MangaUI";

export default function MangaLibraryScreen() {
  const insets = useSafeAreaInsets();
  const items = useMangaLibrary();
  const progress = useContinueReading(1000);
  const metrics = useCardLayout("manga-library");
  const [query, setQuery] = useState("");
  const [readingOnly, setReadingOnly] = useState(false);
  const progressById = useMemo(() => new Map(progress.map((item) => [`${item.source}:${item.id}`, item])), [progress]);
  const readingCount = items.filter(item => progressById.has(`${item.source}:${item.id}`)).length;
  const shown = useMemo(() => items.filter((item) => normFuzzy(item.title).includes(normFuzzy(query)) &&
    (!readingOnly || progressById.has(`${item.source}:${item.id}`))), [items, query, readingOnly, progressById]);
  const remove = (card: MangaCard) => Alert.alert("إزالة من المكتبة؟", card.title, [
    { text: t.cancel, style: "cancel" },
    { text: t.remove, style: "destructive", onPress: () => void removeFromMangaLibrary(card.source, card.id) },
  ]);

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.heading}><Text style={s.eyebrow}>YOUR READING SHELF</Text><Text style={s.title}>مكتبتي</Text><Text style={s.count}>{items.length} عمل محفوظ · {readingCount} أقرأ الآن</Text></View>
        <Pressable style={s.iconBtn} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t.back}>
          <Ionicons name="chevron-forward" size={23} color={M.ink} />
        </Pressable>
      </View>
      {items.length > 0 && <>
        <View style={s.search}>
          <Ionicons name="search" size={20} color={M.muted} />
          <TextInput value={query} onChangeText={setQuery} style={s.input} placeholder="ابحث في مكتبتك…" placeholderTextColor={M.muted}
            accessibilityLabel="البحث في مكتبة المانجا" returnKeyType="search" />
          {query.length > 0 && <Pressable onPress={() => setQuery("")} style={s.iconBtn} accessibilityRole="button" accessibilityLabel={t.cancel}><Ionicons name="close" size={20} color={M.muted} /></Pressable>}
        </View>
        <View style={s.tabs}>
          {[{ label: "أقرأ الآن", active: readingOnly, value: true }, { label: "كل الأعمال", active: !readingOnly, value: false }].map((tab) =>
            <Pressable key={tab.label} style={[s.tab, tab.active && s.tabActive]} onPress={() => setReadingOnly(tab.value)} accessibilityRole="button" accessibilityState={{ selected: tab.active }}>
              <Text style={[s.tabText, tab.active && { color: M.accent }]}>{tab.label}</Text>
            </Pressable>)}
        </View>
        <View style={s.results}><MangaLayoutControl layout={metrics.layout} onChange={metrics.setLayout} /><Text style={s.resultLabel}>{shown.length} {t.mangaSeries}</Text></View>
      </>}
      <MangaGrid cards={shown} metrics={metrics} bottomInset={insets.bottom}
        subtitle={(card) => { const item = progressById.get(`${card.source}:${card.id}`); return item ? `الفصل ${item.chapterNumber} · الصفحة ${item.page + 1}` : card.type ?? undefined; }}
        corner={(card) => <Pressable style={s.remove} onPress={() => remove(card)} accessibilityRole="button" accessibilityLabel={`${t.remove}: ${card.title}`}><Ionicons name="close" size={19} color={M.ink} /></Pressable>}
        empty={<MangaState icon={items.length ? "search-outline" : "bookmarks-outline"} variant="empty"
          title={items.length ? "لا توجد أعمال مطابقة" : t.mangaLibraryEmpty} message={items.length ? "غيّر البحث أو اعرض كل الأعمال المحفوظة." : t.mangaLibraryEmptySub}
          primary={{ label: items.length ? "عرض كل الأعمال" : t.mangaBrowseNow, onPress: () => { if (items.length) { setQuery(""); setReadingOnly(false); } else router.replace("/(tabs)/manga"); }, icon: "book-outline" }} />} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: M.paper },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 20, gap: 16 },
  heading: { flex: 1, alignItems: "flex-end" },
  eyebrow: { ...MT.number, fontSize: 10, letterSpacing: 1.6, color: M.accent, textAlign: "right" },
  title: { ...MT.display, color: M.ink },
  count: { ...MT.caption, color: M.muted, textAlign: "right" },
  iconBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: M.sheet, borderWidth: 1, borderColor: M.line },
  search: { flexDirection: "row", minHeight: 56, alignItems: "center", paddingLeft: 16, marginHorizontal: 20, borderRadius: 4, backgroundColor: M.sheet, borderWidth: 1, borderColor: M.line },
  input: { flex: 1, minWidth: 0, ...MT.body, color: M.ink, textAlign: "right", paddingHorizontal: 12, paddingVertical: 10 },
  tabs: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderColor: M.line },
  tab: { flex: 1, minHeight: 48, paddingHorizontal: 12, paddingVertical: 6, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: M.sheet, borderWidth: 1, borderColor: M.line },
  tabActive: { backgroundColor: M.accentWash, borderColor: M.accent },
  tabText: { ...MT.label, color: M.muted },
  results: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  resultLabel: { ...MT.label, color: M.muted },
  remove: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: M.sheet, borderWidth: 1, borderColor: M.line },
});
