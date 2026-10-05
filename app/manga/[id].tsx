// Manga detail — paper cover header, read-progress signal, collapsible
// synopsis, and a persistent bottom action bar (read/continue + library) over
// the fully virtualized chapter list. Chapters are the FlatList data; everything
// above them is the list header so 1000+ chapter series stay smooth.
import { MangaSkeleton, MangaCover, MangaState } from "../../components/MangaUI";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { M, MT } from "../../lib/manga/design";
import { t } from "../../lib/i18n";
import { normFuzzy } from "../../lib/fuzzy";
import { chapterNumberKey } from "../../lib/manga/aggregate";
import { fetchMergedDetail, readCachedMergedDetail } from "../../lib/manga/aggregate";
import { decodeMangaRef, type MergedChapter, type MergedMangaDetail } from "../../lib/manga/types";
import { upgradeMangaCover } from "../../lib/manga/cover";
import {
  mangaChapterReadKey,
  toggleMangaLibrary,
  useInMangaLibrary,
  useMangaProgress,
  useReadChapters,
} from "../../lib/manga/store";
import { openMangaReader } from "../../lib/manga/nav";
import { ChapterRow } from "../../components/ChapterRow";

const COVER_WIDTH = 110;
const BAR_HEIGHT = 76;
const LIST_BOTTOM_SPACE = BAR_HEIGHT + 28;

export default function MangaDetailScreen() {
  const params = useLocalSearchParams<{ id?: string; title?: string; cover?: string }>();
  const rawId = typeof params.id === "string" ? params.id : "";
  const decoded = useMemo(() => decodeMangaRef(rawId), [rawId]);
  const source = decoded?.source ?? "asq";
  const nativeId = decoded?.id ?? "";
  const titleParam = typeof params.title === "string" ? params.title : "";
  const coverParam = typeof params.cover === "string" ? params.cover : "";

  const insets = useSafeAreaInsets();
  const [bottomHeight, setBottomHeight] = useState(LIST_BOTTOM_SPACE);
  const [chapterQuery, setChapterQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const loadSeq = useRef(0);
  const [detail, setDetail] = useState<MergedMangaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [newestFirst, setNewestFirst] = useState(true);
  const [synopsisOpen, setSynopsisOpen] = useState(false);

  const saved = useInMangaLibrary(source, nativeId);
  const progress = useMangaProgress(source, nativeId);
  const readIds = useReadChapters(source, nativeId);
  const readSet = useMemo(() => new Set(readIds), [readIds]);
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; loadSeq.current++; }; }, []);

  const load = useCallback(async (force = false) => {
    if (!decoded) return;
    const seq = ++loadSeq.current;
    const current = () => aliveRef.current && loadSeq.current === seq;
    setError(false);
    setLoading(true);
    // Stale-while-revalidate: the persisted merged detail paints instantly,
    // then the network pass repaints with the anchor source's chapters and
    // finally with the cross-source union (onUpdate).
    let hadCache = false;
    try {
      const cached = await readCachedMergedDetail(decoded.source, decoded.id);
      if (cached && current()) {
        hadCache = true;
        setDetail(cached);
        setLoading(false);
      }
    } catch {
      // cache miss is fine
    }
    try {
      // onUpdate streams the anchor + merged passes; the resolved value is
      // also applied because joining an already in-flight merge skips
      // onUpdate entirely.
      await fetchMergedDetail(decoded.source, decoded.id, {
        force,
        onUpdate: (merged) => {
          if (current()) setDetail(merged);
        },
      }).then((merged) => {
        if (current()) setDetail(merged);
      });
      if (current()) setError(false);
    } catch {
      if (current() && !hadCache) setError(true);
    } finally {
      if (current()) setLoading(false);
    }
  }, [decoded]);

  useEffect(() => {
    setDetail(null);
    setChapterQuery("");
    setUnreadOnly(false);
    void load();
    return () => { loadSeq.current++; };
  }, [load]);

  const ordered = useMemo(() => {
    if (!detail) return [];
    const query = normFuzzy(chapterQuery);
    const number = chapterNumberKey(chapterQuery);
    const chapters = detail.chapters.filter((chapter) =>
      (!unreadOnly || !readSet.has(mangaChapterReadKey(chapter.source, chapter.id))) &&
      (!chapterQuery.trim() || (number && chapterNumberKey(chapter.number).includes(number)) || (query && normFuzzy(chapter.title ?? "").includes(query))));
    return newestFirst ? chapters : [...chapters].reverse();
  }, [detail, newestFirst, chapterQuery, unreadOnly, readSet]);

  // Series read progress: how many merged chapters carry a read mark. O(n) once
  // per detail/readSet change — never per row.
  const completedChapters = useMemo(() => {
    if (!detail) return 0;
    let count = 0;
    for (const chapter of detail.chapters) {
      if (readSet.has(mangaChapterReadKey(chapter.source, chapter.id))) count += 1;
    }
    return count;
  }, [detail, readSet]);
  const totalChapters = detail?.chapters.length ?? 0;
  const readPercent = totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0;

  const openChapter = useCallback(
    (chapter: MergedChapter) => {
      if (!detail) return;
      openMangaReader({
        source: detail.source,
        mangaId: detail.id,
        mangaTitle: detail.title,
        chapter: {
          source: chapter.source,
          mangaId: chapter.mangaId,
          id: chapter.id,
          number: chapter.number,
        },
        cover: detail.cover,
      });
    },
    [detail],
  );

  const onPrimary = useCallback(() => {
    if (!detail || detail.chapters.length === 0) return;
    if (progress?.chapterId) {
      // The saved chapter may now be served by another source; resolve it by
      // native id + owning source, then by chapter number, before falling back
      // to the last chapter.
      const chapterSource = progress.chapterSource ?? detail.source;
      const match =
        detail.chapters.find(
          (chapter) => chapter.id === progress.chapterId && chapter.source === chapterSource,
        ) ??
        (progress.chapterNumber
          ? detail.chapters.find((chapter) => chapter.number === progress.chapterNumber)
          : undefined);
      if (match) {
        openChapter(match);
        return;
      }
    }
    openChapter(detail.chapters[detail.chapters.length - 1]);
  }, [detail, progress, openChapter]);

  const onToggleLibrary = useCallback(async () => {
    if (!detail) return;
    await toggleMangaLibrary(detail);
  }, [detail]);

  if (!decoded) {
    return (
      <View style={s.root}>
        <StatusBar style="dark" />
        <MangaState
          icon="alert-circle-outline"
          variant="error"
          title={t.mangaLoadError}
          message={t.mangaLoadErrorSub}
          primary={{ label: t.back, onPress: () => router.back(), icon: "arrow-forward" }}
        />
      </View>
    );
  }

  const coverUrl = upgradeMangaCover(detail?.cover ?? coverParam) ?? "";
  const canRead = !!detail && detail.chapters.length > 0;
  const showSkeleton = loading && !detail && !titleParam;
  const primaryLabel = progress
    ? `${t.mangaContinue} • الفصل ${progress.chapterNumber}`
    : t.mangaStartReading;

  const metaParts: { key: string; node: ReactNode }[] = [];
  if (detail?.type) metaParts.push({ key: "type", node: <Text style={s.metaType}>{detail.type}</Text> });
  if (detail?.status) metaParts.push({ key: "status", node: <Text style={s.metaText}>{detail.status}</Text> });
  if (detail?.year) metaParts.push({ key: "year", node: <Text style={s.metaText}>{detail.year}</Text> });
  if (detail?.rating) {
    metaParts.push({
      key: "rating",
      node: (
        <View style={s.ratingPart}>
          <Ionicons name="star" size={12} color={M.rating} />
          <Text style={s.ratingText}>{detail.rating}</Text>
        </View>
      ),
    });
  }

  const header = showSkeleton ? (
    <HeaderSkeleton />
  ) : (
    <View>
      <View style={s.headRow}>
        <MangaCover uri={coverUrl} label={detail?.title ?? titleParam} style={s.coverPlate} />

        <View style={s.headInfo}>
          <Text style={s.eyebrow}>MANGA / STORY</Text>
          <Text style={s.title}>
            {detail?.title ?? titleParam}
          </Text>
          {detail?.author ? (
            <Text style={s.author} numberOfLines={1}>
              {t.mangaAuthor}: {detail.author}
            </Text>
          ) : null}
          {metaParts.length > 0 ? (
            <View style={s.metaRow}>
              {metaParts.map((part) => <View key={part.key} style={s.metaItem}>{part.node}</View>)}
            </View>
          ) : null}
        </View>
      </View>

      {detail && detail.genres.length > 0 && (
        <View style={s.genres}>
          {detail.genres.slice(0, 12).map((genre) => (
            <View key={genre} style={s.genreChip}>
              <Text style={s.genreText}>{genre}</Text>
            </View>
          ))}
        </View>
      )}

      {detail && <View style={s.stats}>
        <View style={s.stat}><Text style={s.statNumber}>{totalChapters}</Text><Text style={s.statLabel}>فصل متاح</Text></View>
        <View style={[s.stat, s.statMiddle]}><Text style={s.statNumber}>{completedChapters}</Text><Text style={s.statLabel}>فصل مقروء</Text></View>
        <View style={s.stat}><Text style={[s.statNumber, { color: M.read }]}>{readPercent}%</Text><Text style={s.statLabel}>من القصة</Text></View>
      </View>}

      {detail?.synopsis ? (
        <View style={s.synopsisBlock}>
          <Text style={s.sectionLabel}>{t.mangaSynopsis}</Text>
          <Text style={s.synopsisText} numberOfLines={synopsisOpen ? undefined : 4}>
            {detail.synopsis}
          </Text>
          {detail.synopsis.length > 160 && (
            <Pressable
              style={s.moreBtn}
              onPress={() => setSynopsisOpen((v) => !v)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={synopsisOpen ? t.mangaShowLess : t.mangaShowMore}
            >
              <Text style={s.moreText}>{synopsisOpen ? t.mangaShowLess : t.mangaShowMore}</Text>
              <Ionicons
                name={synopsisOpen ? "chevron-up" : "chevron-down"}
                size={14}
                color={M.accent}
                style={s.moreIcon}
              />
            </Pressable>
          )}
        </View>
      ) : null}

      <View style={s.rule} />

      <View style={s.chaptersHeader}>
        <View style={s.chaptersTitleWrap}>
          <Text style={s.chaptersTitle}>
            {t.mangaChapters}
            {detail ? <Text style={s.chaptersCount}> ({detail.chapters.length})</Text> : null}
          </Text>
          {progress?.chapterNumber ? (
            <Text style={s.continueNote} numberOfLines={1}>
              {t.mangaContinueReading} · الفصل {progress.chapterNumber}
            </Text>
          ) : null}
        </View>
        <Pressable
          style={({ pressed }) => [s.sortBtn, pressed && { opacity: 0.7 }]}
          onPress={() => setNewestFirst((v) => !v)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={newestFirst ? t.mangaSortOldest : t.mangaSortNewest}
        >
          <Ionicons name="swap-vertical" size={13} color={M.muted} />
          <Text style={s.sortText}>{newestFirst ? t.mangaSortNewest : t.mangaSortOldest}</Text>
        </Pressable>
      </View>

      {completedChapters > 0 ? (
        <View style={s.progressBlock}>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${readPercent}%` }]} />
          </View>
          <Text style={s.progressText}>
            {t.mangaRead} {completedChapters} / {totalChapters}
          </Text>
        </View>
      ) : null}
      {detail && detail.chapters.length > 0 && <>
        <View style={s.chapterSearch}>
          <Ionicons name="search" size={18} color={M.muted} />
          <TextInput value={chapterQuery} onChangeText={setChapterQuery} placeholder={t.mangaChapterFilter} placeholderTextColor={M.muted}
            style={s.chapterInput} accessibilityLabel={t.mangaChapterFilter} returnKeyType="search" />
          {chapterQuery.length > 0 && <Pressable style={s.clearSearch} onPress={() => setChapterQuery("")} accessibilityRole="button" accessibilityLabel={t.cancel}><Ionicons name="close" size={18} color={M.muted} /></Pressable>}
        </View>
        <View style={s.chapterTabs}>
          <Pressable style={[s.chapterTab, unreadOnly && s.chapterTabActive]} onPress={() => setUnreadOnly(true)} accessibilityRole="button" accessibilityState={{ selected: unreadOnly }}><Text style={[s.chapterTabText, unreadOnly && { color: M.accent }]}>لم أقرأها</Text></Pressable>
          <Pressable style={[s.chapterTab, !unreadOnly && s.chapterTabActive]} onPress={() => setUnreadOnly(false)} accessibilityRole="button" accessibilityState={{ selected: !unreadOnly }}><Text style={[s.chapterTabText, !unreadOnly && { color: M.accent }]}>كل الفصول</Text></Pressable>
        </View>
      </>}
    </View>
  );

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <View style={[s.pageHeader, { paddingTop: insets.top + 8 }]}>
        <Text style={s.wordmark}>MANGA</Text>
        <Text style={s.pageHeaderTitle}>دليل العمل</Text>
        <Pressable style={s.clearSearch} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t.back}><Ionicons name="chevron-forward" size={24} color={M.ink} /></Pressable>
      </View>
      <FlatList
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        removeClippedSubviews={false}
        data={ordered}
        keyExtractor={(chapter) => `${chapter.source}:${chapter.id}`}
        renderItem={({ item }) => (
          <ChapterRow
            number={item.number}
            title={item.title}
            date={item.date}
            read={readSet.has(mangaChapterReadKey(item.source, item.id))}
            active={
              progress?.chapterId === item.id &&
              (progress.chapterSource ?? source) === item.source
            }
            onPress={() => openChapter(item)}
          />
        )}
        ListHeaderComponent={header}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          loading ? (
            <View style={s.chapterSkeletonWrap}>
              {[0, 1, 2, 3, 4].map((i) => (
                <MangaSkeleton key={i} style={s.chapterSkeleton} borderRadius={6} />
              ))}
            </View>
          ) : error ? (
            <MangaState
              icon="cloud-offline-outline"
              variant="error"
              title={t.mangaLoadError}
              message={t.mangaLoadErrorSub}
              primary={{ label: t.retry, onPress: () => void load(true), icon: "refresh" }}
            />
          ) : (
            <Text style={s.noChapters}>{chapterQuery || unreadOnly ? "لا توجد فصول مطابقة" : t.mangaNoChapters}</Text>
          )
        }
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomHeight + 24 }}
        initialNumToRender={16}
        maxToRenderPerBatch={12}
        windowSize={9}
        showsVerticalScrollIndicator={false}
      />

      {detail ? (
        <View onLayout={(event) => setBottomHeight(event.nativeEvent.layout.height)} style={[s.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            style={({ pressed }) => [s.cta, pressed && { opacity: 0.9 }, !canRead && s.ctaDisabled]}
            onPress={onPrimary}
            disabled={!canRead}
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
            accessibilityState={{ disabled: !canRead }}
          >
            <Ionicons name="book-outline" size={17} color={M.white} />
            <Text style={s.ctaText}>
              {primaryLabel}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.saveBtn, saved && s.saveBtnOn, pressed && { opacity: 0.85 }]}
            onPress={() => void onToggleLibrary()}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityState={{ selected: !!saved }}
            accessibilityLabel={saved ? "إزالة من المكتبة" : "حفظ في المكتبة"}
          >
            <Ionicons
              name={saved ? "bookmark" : "bookmark-outline"}
              size={20}
              color={saved ? M.read : M.ink}
            />
            <Text style={s.saveLabel}>{saved ? "محفوظ" : "حفظ"}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function HeaderSkeleton() {
  return <View>
    <View style={s.headRow}><MangaSkeleton style={s.skeletonCover} /><View style={s.headInfo}>
      <MangaSkeleton style={{ width: "80%", height: 26, marginBottom: 12 }} />
      <MangaSkeleton style={{ width: "60%", height: 18, marginBottom: 12 }} />
      <MangaSkeleton style={{ width: "90%", height: 18 }} />
    </View></View>
    <MangaSkeleton style={{ height: 72, marginTop: 24 }} />
    <MangaSkeleton style={{ height: 100, marginVertical: 24 }} />
  </View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: M.paper },
  pageHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 10, backgroundColor: M.paper, borderBottomWidth: 1, borderColor: M.line, gap: 12 },
  wordmark: { ...MT.number, fontSize: 12, letterSpacing: 2, color: M.accent },
  pageHeaderTitle: { ...MT.label, flex: 1, color: M.muted, textAlign: "right" },
  chapterSearch: { minHeight: 56, flexDirection: "row", alignItems: "center", backgroundColor: M.sheet, borderRadius: 4, borderWidth: 1, borderColor: M.line, paddingLeft: 12, marginTop: 8 },
  chapterInput: { ...MT.body, flex: 1, minWidth: 0, color: M.ink, textAlign: "right", paddingHorizontal: 12, paddingVertical: 10 },
  clearSearch: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  chapterTabs: { flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingVertical: 16 },
  chapterTab: { minHeight: 48, justifyContent: "center", paddingHorizontal: 16, borderRadius: 4, borderWidth: 1, borderColor: M.line, backgroundColor: M.sheet },
  chapterTabActive: { backgroundColor: M.accentWash, borderColor: M.accent },
  chapterTabText: { ...MT.label, color: M.muted },
  headRow: { flexDirection: "row-reverse", marginTop: 24, alignItems: "flex-start", gap: 18 },
  coverPlate: { width: COVER_WIDTH, aspectRatio: 2 / 3, borderRadius: 4, borderWidth: 1, borderColor: M.line },
  headInfo: { flex: 1, alignItems: "flex-end", minWidth: 0 },
  eyebrow: { ...MT.number, fontSize: 9, letterSpacing: 1.5, color: M.accent, marginBottom: 6 },
  title: { ...MT.title, fontSize: 24, lineHeight: 36, color: M.ink, textAlign: "right" },
  author: { ...MT.caption, color: M.muted, textAlign: "right", marginTop: 8 },
  metaRow: { flexDirection: "row-reverse", flexWrap: "wrap", alignItems: "center", marginTop: 10, gap: 6 },
  metaItem: { backgroundColor: M.wash, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
  metaType: { ...MT.caption, color: M.accent },
  metaText: { ...MT.caption, color: M.muted },
  ratingPart: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { ...MT.caption, color: M.rating },
  genres: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 6, marginTop: 20 },
  genreChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 3, backgroundColor: M.wash },
  genreText: { ...MT.caption, color: M.muted },
  stats: { flexDirection: "row-reverse", paddingVertical: 18, marginTop: 22, borderTopWidth: 1, borderBottomWidth: 1, borderColor: M.line },
  stat: { flex: 1, alignItems: "center", gap: 3 },
  statMiddle: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: M.line },
  statNumber: { ...MT.number, fontSize: 24, lineHeight: 32, color: M.ink },
  statLabel: { ...MT.caption, color: M.muted, textAlign: "center" },
  synopsisBlock: { marginTop: 24 },
  sectionLabel: { ...MT.heading, color: M.ink, textAlign: "right" },
  synopsisText: { ...MT.body, lineHeight: 28, color: M.muted, textAlign: "right", marginTop: 8 },
  moreBtn: { flexDirection: "row-reverse", alignItems: "center", alignSelf: "flex-end", minHeight: 48, paddingHorizontal: 2 },
  moreText: { ...MT.label, color: M.accent },
  moreIcon: { marginRight: 6 },
  rule: { height: 1, backgroundColor: M.line, marginTop: 28 },
  chaptersHeader: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 18, marginBottom: 12 },
  chaptersTitleWrap: { alignItems: "flex-end", flex: 1, minWidth: 0 },
  chaptersTitle: { ...MT.heading, color: M.ink, textAlign: "right" },
  chaptersCount: { ...MT.caption, color: M.muted },
  continueNote: { ...MT.caption, color: M.accent, textAlign: "right", marginTop: 4 },
  sortBtn: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 48, paddingHorizontal: 10, borderRadius: 4, backgroundColor: M.wash, flexShrink: 1 },
  sortText: { ...MT.caption, color: M.ink, flexShrink: 1 },
  progressBlock: { marginBottom: 12 },
  progressTrack: { height: 4, backgroundColor: M.wash, overflow: "hidden", alignItems: "flex-end" },
  progressFill: { height: "100%", backgroundColor: M.read },
  progressText: { ...MT.caption, color: M.muted, textAlign: "right", marginTop: 5 },
  chapterSkeletonWrap: { gap: 8, paddingTop: 4 },
  chapterSkeleton: { height: 80, width: "100%" },
  noChapters: { ...MT.body, color: M.muted, textAlign: "center", paddingVertical: 30 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 30, flexDirection: "row-reverse", alignItems: "stretch", gap: 10, paddingHorizontal: 20, paddingTop: 12, backgroundColor: M.paper, borderTopWidth: 1, borderTopColor: M.line },
  cta: { flex: 1, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, gap: 10, borderRadius: 4, backgroundColor: M.accent },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { ...MT.label, color: M.white, flexShrink: 1, textAlign: "center" },
  saveBtn: { minWidth: 64, minHeight: 56, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: M.sheet, borderWidth: 1, borderColor: M.line },
  saveBtnOn: { borderColor: M.read, backgroundColor: M.readWash },
  saveLabel: { ...MT.caption, color: M.ink },
  skeletonCover: { width: COVER_WIDTH, aspectRatio: 2 / 3 },
});
