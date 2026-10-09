import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Modal,
  PanResponder,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  AccessibilityInfo,
  useWindowDimensions,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { MangaPageImage } from "../../components/MangaPageImage";
import { normFuzzy } from "../../lib/fuzzy";
import { chapterNumberKey } from "../../lib/manga/aggregate";
import { useReducedMotion } from "../../lib/motion";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as ScreenOrientation from "expo-screen-orientation";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { M, MT, MANGA_FILL } from "../../lib/manga/design";
import { t } from "../../lib/i18n";
import { fetchMangaChapter } from "../../lib/manga/api";
import { fetchMergedDetail } from "../../lib/manga/aggregate";
import { decodeReaderRef, type MergedChapter, type MergedMangaDetail } from "../../lib/manga/types";
import {
  flushMangaStore,
  getMangaProgress,
  mangaChapterReadKey,
  markMangaChapterRead,
  saveMangaProgress,
  setMangaChapterRead,
  useReadChapters,
} from "../../lib/manga/store";
import { replaceMangaReader } from "../../lib/manga/nav";
import { ChapterRow } from "../../components/ChapterRow";
import { MangaState } from "../../components/MangaUI";

type ReaderMode = "vertical" | "paged" | "pagedV";
type ReaderDirection = "ltr" | "rtl";
type RotationPref = "auto" | "locked";
type FitMode = "width" | "screen" | "height" | "stretch" | "original" | "smart";

interface ReaderPrefs {
  mode: ReaderMode;
  direction: ReaderDirection;
  rotation: RotationPref;
  fit: FitMode;
}

const PREFS_KEY = "manga_reader_prefs_v2";
const RATIOS_KEY = "manga_page_ratios_v1";
const DEFAULT_PREFS: ReaderPrefs = { mode: "vertical", direction: "rtl", rotation: "auto", fit: "width" };

const FIT_MODES: FitMode[] = ["width", "screen", "height", "stretch", "original", "smart"];

// ── aspect-ratio cache (persisted) ───────────────────────────────────────────
// Knowing a page's ratio before its bitmap arrives keeps placeholder heights
// correct, which is what makes the continuous scroll anchor stable and the
// page edges uniform.
const ratioCache = new Map<string, number>();
// Natural pixel width (memory-only) — feeds the "original size" fit mode and
// intrinsic-size fit mode.
const naturalWidthCache = new Map<string, number>();
// Last measured page ratio (session-only). Consecutive pages in a chapter are
// almost always the same shape, so seeding the next page's box with the
// previous page's ratio lets it decode once at (nearly) its final size instead
// of decoding a small placeholder bitmap and re-decoding at full size on every
// first read.
let recentRatio = 0;

/** Keep intrinsic dimensions without retaining decoded image references. */
function noteNaturalWidth(uri: string, width: number): number {
  const known = naturalWidthCache.get(uri) ?? 0;
  if (width > known) naturalWidthCache.set(uri, width);
  return Math.max(known, width > 0 ? width : 0);
}
let ratiosLoaded = false;
let ratioSaveTimer: ReturnType<typeof setTimeout> | null = null;

async function loadRatioCache(): Promise<void> {
  if (ratiosLoaded) return;
  ratiosLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(RATIOS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && value > 0) ratioCache.set(key, value);
    }
  } catch {
    // corrupt cache — start fresh
  }
}

function persistRatioCache(): void {
  const out: Record<string, number> = {};
  let count = 0;
  for (const [key, value] of ratioCache) {
    out[key] = value;
    if (++count >= 4000) break;
  }
  void AsyncStorage.setItem(RATIOS_KEY, JSON.stringify(out)).catch(() => {});
}

function rememberRatio(uri: string, ratio: number): void {
  if (!(ratio > 0) || ratioCache.get(uri) === ratio) return;
  if (ratio > 0.4 && ratio < 16) recentRatio = ratio;
  ratioCache.set(uri, ratio);
  if (ratioCache.size > 4500) {
    const keys = ratioCache.keys();
    for (let i = 0; i < 1500; i++) {
      const key = keys.next().value;
      if (key === undefined) break;
      ratioCache.delete(key);
    }
  }
  if (ratioSaveTimer) return;
  ratioSaveTimer = setTimeout(() => {
    ratioSaveTimer = null;
    persistRatioCache();
  }, 3000);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

async function loadReaderPrefs(): Promise<ReaderPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    return {
      mode: parsed.mode === "paged" ? "paged" : parsed.mode === "pagedV" ? "pagedV" : "vertical",
      direction: parsed.direction === "ltr" ? "ltr" : "rtl",
      rotation: parsed.rotation === "locked" ? "locked" : "auto",
      fit: FIT_MODES.includes(parsed.fit as FitMode) ? (parsed.fit as FitMode) : "width",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface VerticalDims {
  width: number;
  height: number;
  contentFit: "fill" | "cover" | "contain";
}

/** Container dimensions for a vertical page under the selected fit mode.
 * Every non-cover mode uses the exact ratio, so `contain` fills the box exactly
 * (same pixels as `fill`) while still letting expo-image re-decode when the
 * placeholder box grows to the measured ratio — expo-image skips the resize
 * re-request for `fill`, which left the small placeholder bitmap stretched and
 * blurry until the reader remounted. "height" fills the screen height and only
 * crops ultra-wide spreads (cover). */
function verticalDims(
  fit: FitMode,
  screenW: number,
  screenH: number,
  ratio: number,
  naturalW: number,
  dpr: number,
): VerticalDims {
  switch (fit) {
    case "stretch":
      return { width: screenW, height: screenH, contentFit: "fill" };
    case "screen": {
      const width = Math.min(screenW, screenH / ratio);
      return { width, height: width * ratio, contentFit: "contain" };
    }
    case "height": {
      const exactWidth = screenH / ratio;
      if (exactWidth <= screenW) return { width: exactWidth, height: screenH, contentFit: "contain" };
      return { width: screenW, height: screenH, contentFit: "cover" };
    }
    case "original": {
      const width = naturalW > 0 ? Math.min(screenW, naturalW / dpr) : screenW;
      return { width, height: width * ratio, contentFit: "contain" };
    }
    case "smart": {
      if (ratio >= 1) return { width: screenW, height: screenW * ratio, contentFit: "contain" };
      const width = Math.min(screenW, screenH / ratio);
      return { width, height: width * ratio, contentFit: "contain" };
    }
    case "width":
    default:
      return { width: screenW, height: screenW * ratio, contentFit: "contain" };
  }
}

// A fixed decode target avoids decoding again at every measured-height change.
// shortcut: very long strips lose pixel density; use native tiling if full-density strips are needed.
function verticalDecodeSize(screenWidth: number, dpr: number): { width: number; height: number } {
  const width = Math.max(1, Math.min(4096, Math.ceil(screenWidth * dpr)));
  return { width, height: Math.max(1, Math.min(8192, Math.floor(8_000_000 / width))) };
}

export default function MangaReaderScreen() {
  const params = useLocalSearchParams<{ chapter?: string; title?: string; num?: string; cover?: string }>();
  const ref = typeof params.chapter === "string" ? params.chapter : "";
  const decoded = useMemo(() => decodeReaderRef(ref), [ref]);
  // Anchor = stable work identity (progress/library); the chapter may live on
  // a different source after the cross-source merge.
  const source = decoded?.source ?? "asq";
  const mangaId = decoded?.mangaId ?? "";
  const chapterSource = decoded?.chapterSource ?? source;
  const chapterMangaId = decoded?.chapterMangaId ?? mangaId;
  const chapterId = decoded?.chapterId ?? "";
  const mangaTitle = typeof params.title === "string" ? params.title : "";
  const chapterNumber = typeof params.num === "string" ? params.num : "";
  const coverParam = typeof params.cover === "string" ? params.cover : "";

  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);
    return () => sub.remove();
  }, []);
  const imageHeaders = useMemo(() => ({ Referer: chapterSource === "asq" ? chapterId
    : chapterSource === "mangalik" ? `https://mangalik.net/manga/${encodeURIComponent(chapterMangaId)}/${encodeURIComponent(chapterId)}/`
    : `https://mangawy.org/series/${encodeURIComponent(chapterMangaId)}/chapter/${encodeURIComponent(chapterId)}` }), [chapterSource, chapterMangaId, chapterId]);
  const { width, height } = useWindowDimensions();
  const widthRounded = Math.round(width);
  const dpr = Math.min(PixelRatio.get() || 2, 3);

  const [pages, setPages] = useState<string[] | null>(null);
  const [detail, setDetail] = useState<MergedMangaDetail | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [progressReady, setProgressReady] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [chapterQuery, setChapterQuery] = useState("");
  // Bumped once the persisted ratio cache hydrates (AsyncStorage is async and
  // can lose the race against the chapter fetch). Re-renders the vertical pages
  // so they pick up exact heights instead of the 1.45× placeholder.
  const [ratioTick, setRatioTick] = useState(0);
  // Keep the next-chapter network request out of active drags and flings.
  const [scrolling, setScrolling] = useState(false);

  const verticalRef = useRef<FlatList<string>>(null);
  const pagedRef = useRef<FlatList<string>>(null);
  const pagedVRef = useRef<FlatList<string>>(null);
  const pendingPageRef = useRef(0);
  const jumpRetryRef = useRef({ target: -1, attempts: 0, timer: null as ReturnType<typeof setTimeout> | null });
  const restoredRef = useRef(false);
  const userInteractedRef = useRef(false);
  const pagesRef = useRef<string[] | null>(null);
  const displayedPagesRef = useRef(new Set<string>());
  const indexRef = useRef(0);
  const directionRef = useRef(prefs.direction);
  const saveRef = useRef<(pageIndex: number, total: number) => void>(() => {});
  const touchRef = useRef({ x: 0, y: 0, t: 0 });
  const nextChapterPrefetchRef = useRef<string | null>(null);
  const zoomedRef = useRef(false);
  const restoringRef = useRef(false);
  const scrollToTargetRef = useRef<(target: number) => void>(() => {});
  const scrollSettleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  pagesRef.current = pages;
  indexRef.current = index;
  directionRef.current = prefs.direction;
  zoomedRef.current = zoomed;

  // Programmatic, non-animated jump used by restore paths. Reads everything
  // from refs so it can be called from async callbacks without stale closures.
  scrollToTargetRef.current = (target: number) => {
    const totalNow = pagesRef.current?.length ?? 0;
    if (!totalNow) return;
    const clamped = clamp(target, 0, totalNow - 1);
    try {
      if (prefs.mode === "vertical") {
        verticalRef.current?.scrollToIndex({ index: clamped, animated: false, viewPosition: 0 });
      } else if (prefs.mode === "paged") {
        const display = prefs.direction === "rtl" ? totalNow - 1 - clamped : clamped;
        pagedRef.current?.scrollToIndex({ index: display, animated: false });
      } else {
        pagedVRef.current?.scrollToIndex({ index: clamped, animated: false });
      }
    } catch {
      // unmeasured list — the failed handler retries
    }
  };

  const readIds = useReadChapters(source, mangaId);
  const readSet = useMemo(() => new Set(readIds), [readIds]);

  // One native scroll gesture, composed against pinch so the list and the
  // zoom layer arbitrate instead of racing (Android).
  const listNative = useMemo(() => Gesture.Native(), []);

  // ── prefs / ratios / rotation ──────────────────────────────────────────────
  useEffect(() => {
    void loadRatioCache().then(() => setRatioTick((tick) => tick + 1));
    let alive = true;
    void loadReaderPrefs().then((loaded) => {
      if (!alive) return;
      setPrefs(loaded);
      setPrefsLoaded(true);
    });
    return () => {
      alive = false;
      persistRatioCache();
    };
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    void AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => {});
  }, [prefs, prefsLoaded]);

  useEffect(() => {
    if (!prefsLoaded) return;
    if (prefs.rotation === "auto") {
      void ScreenOrientation.unlockAsync().catch(() => {});
    } else {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
  }, [prefs.rotation, prefsLoaded]);

  useEffect(() => {
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  // ── load chapter + detail + saved position ─────────────────────────────────
  // Pages and detail are fetched independently: the first page paints as soon
  // as the chapter payload lands, even if the detail payload is still in
  // flight (it only feeds chapter navigation).
  useEffect(() => {
    if (!decoded) return;
    let alive = true;
    setPages(null);
    setProgressReady(false);
    restoringRef.current = true;
    setDetail(null);
    setChrome(true);
    displayedPagesRef.current.clear();
    setError(false);
    setIndex(0);
    restoredRef.current = false;
    userInteractedRef.current = false;
    pendingPageRef.current = 0;
    nextChapterPrefetchRef.current = null;

    void fetchMangaChapter(chapterSource, chapterMangaId, chapterId, { force: reloadKey > 0 })
      .then((data) => {
        if (!alive) return;
        if (data.pages.length > 0) setPages(data.pages);
        else setError(true);
      })
      .catch(() => {
        if (alive) setError(true);
      });

    void fetchMergedDetail(source, mangaId, {
      onUpdate: (merged) => {
        if (alive) setDetail(merged);
      },
    })
      .then((merged) => {
        if (alive) setDetail(merged);
      })
      .catch(() => {});

    void getMangaProgress(source, mangaId).then((progress) => {
      if (!alive) return;
      if (!progress || progress.page <= 0) return;
      // Same chapter, possibly served by a different source after a merge
      // reshuffle — match by native id first, then by chapter number.
      const sameChapter =
        progress.chapterId === chapterId
          ? (progress.chapterSource ?? source) === chapterSource
          : !!chapterNumber && progress.chapterNumber === chapterNumber;
      if (!sameChapter) return;
      pendingPageRef.current = progress.page;
    }).catch(() => {}).finally(() => { if (alive) setProgressReady(true); });

    return () => {
      alive = false;
      if (jumpRetryRef.current.timer) clearTimeout(jumpRetryRef.current.timer);
      flushMangaStore();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, mangaId, chapterSource, chapterMangaId, chapterId, chapterNumber, reloadKey]);

  // Re-anchor when the layout changes (rotation, mode or direction switch).
  useEffect(() => {
    if (restoredRef.current && pagesRef.current) pendingPageRef.current = indexRef.current;
    restoredRef.current = false;
    userInteractedRef.current = false;
  }, [widthRounded, height, prefs.mode, prefs.direction]);

  // A remount while zoomed would leave the fresh list with scrollEnabled=false
  // and no way out — always drop zoom on any list remount trigger.
  useEffect(() => {
    setZoomed(false);
  }, [widthRounded, height, prefs.mode, prefs.direction]);

  // Restore the saved page once pages arrive — but never yank the list after
  // the user has already started swiping.
  useEffect(() => {
    if (!pages || !prefsLoaded || !progressReady || pages.length === 0 || restoredRef.current) return;
    restoredRef.current = true;
    if (userInteractedRef.current) return;
    const target = clamp(pendingPageRef.current, 0, pages.length - 1);
    pendingPageRef.current = target;
    setIndex(target);
    if (target <= 0) {
      restoringRef.current = false;
      return;
    }
    restoringRef.current = true;
    const timer = setTimeout(() => {
      if (!userInteractedRef.current) scrollToTargetRef.current(target);
    }, 260);
    return () => {
      restoringRef.current = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, prefsLoaded, progressReady, prefs.mode, prefs.direction, widthRounded, height]);

  // ── progress saving ────────────────────────────────────────────────────────
  saveRef.current = (pageIndex: number, total: number) => {
    if (total <= 0) return;
    // Don't let the first viewability tick (page 0) overwrite the saved
    // position while the restore jump is still in flight.
    if (!progressReady || !prefsLoaded) return;
    if (restoringRef.current) {
      if (pageIndex !== pendingPageRef.current) return;
      restoringRef.current = false;
    }
    setIndex(pageIndex);
    void saveMangaProgress({
      source,
      id: mangaId,
      title: mangaTitle,
      cover: coverParam || detail?.cover || null,
      chapterId,
      chapterSource,
      chapterMangaId,
      chapterNumber,
      page: pageIndex,
      total,
    });
    if (pageIndex >= total - 1 && displayedPagesRef.current.size === total) {
      void markMangaChapterRead(source, mangaId, mangaChapterReadKey(chapterSource, chapterId));
    }
  };

  const onPageDisplayed = useCallback((uri: string) => {
    displayedPagesRef.current.add(uri);
    if (indexRef.current >= (pagesRef.current?.length ?? 0) - 1) {
      saveRef.current(indexRef.current, pagesRef.current?.length ?? 0);
    }
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    const first = viewableItems?.find((v: any) => v?.isViewable);
    if (first?.index != null) saveRef.current(first.index, pagesRef.current?.length ?? 0);
  }).current;

  const onPagedViewableItemsChanged = useRef(({ viewableItems }: any) => {
    const first = viewableItems?.find((item: any) => item?.isViewable);
    const totalNow = pagesRef.current?.length ?? 0;
    if (first?.index == null || !totalNow) return;
    const realIndex = directionRef.current === "rtl" ? totalNow - 1 - first.index : first.index;
    saveRef.current(realIndex, totalNow);
  }).current;
  const pagedViewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 95, minimumViewTime: 150 }).current;

  const beginInteraction = useCallback(() => {
    userInteractedRef.current = true;
    restoringRef.current = false;
    if (jumpRetryRef.current.timer) clearTimeout(jumpRetryRef.current.timer);
    jumpRetryRef.current.timer = null;
  }, []);

  // Drag end fires just before momentum begins; the short tail keeps prefetch
  // paused across that gap (momentum begin cancels the pending stop).
  const markScrolling = useCallback((on: boolean) => {
    if (scrollSettleRef.current) {
      clearTimeout(scrollSettleRef.current);
      scrollSettleRef.current = null;
    }
    if (on) {
      setScrolling(true);
    } else {
      scrollSettleRef.current = setTimeout(() => {
        scrollSettleRef.current = null;
        setScrolling(false);
      }, 140);
    }
  }, []);

  useEffect(() => () => {
    if (scrollSettleRef.current) clearTimeout(scrollSettleRef.current);
  }, []);

  // Viewport coverage, not item visibility: a webtoon page taller than the
  // screen can never be 60% visible, so itemVisiblePercentThreshold would
  // silently stop saving progress in continuous mode.
  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 15, minimumViewTime: 250 }).current;

  // Virtualized page cells load ahead at display size; Image.prefetch on
  // Android would add uncancellable full-resolution decodes during scrolling.

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") flushMangaStore();
    });
    return () => sub.remove();
  }, []);

  // ── chapter navigation ─────────────────────────────────────────────────────
  const chapters = detail?.chapters ?? [];
  const currentIdx = useMemo(() => {
    let idx = chapters.findIndex(
      (chapter) => chapter.id === chapterId && chapter.source === chapterSource,
    );
    if (idx < 0 && chapterNumber) idx = chapters.findIndex((chapter) => chapter.number === chapterNumber);
    return idx;
  }, [chapters, chapterId, chapterSource, chapterNumber]);
  const newerChapter = currentIdx > 0 ? chapters[currentIdx - 1] : null;
  const olderChapter = currentIdx >= 0 && currentIdx < chapters.length - 1 ? chapters[currentIdx + 1] : null;

  useEffect(() => {
    if (!pages || !newerChapter || !newerChapter.id || scrolling) return;
    if (index < pages.length - 5) return;
    if (nextChapterPrefetchRef.current === `${newerChapter.source}:${newerChapter.id}`) return;
    nextChapterPrefetchRef.current = `${newerChapter.source}:${newerChapter.id}`;
    void fetchMangaChapter(newerChapter.source, newerChapter.mangaId, newerChapter.id)
      .catch(() => {});
  }, [index, pages, newerChapter, scrolling]);

  const goToChapter = useCallback(
    (chapter: MergedChapter) => {
      replaceMangaReader({
        source,
        mangaId,
        mangaTitle,
        chapter: {
          source: chapter.source,
          mangaId: chapter.mangaId,
          id: chapter.id,
          number: chapter.number,
        },
        cover: coverParam || detail?.cover || null,
      });
    },
    [source, mangaId, mangaTitle, coverParam, detail?.cover],
  );

  // ── jumping ────────────────────────────────────────────────────────────────
  const total = pages?.length ?? 0;

  const jumpTo = useCallback(
    (target: number) => {
      if (!pages || pages.length === 0) return;
      beginInteraction();
      const clamped = clamp(target, 0, pages.length - 1);
      jumpRetryRef.current.attempts = 0;
      setIndex(clamped);
      try {
        if (prefs.mode === "vertical") {
          verticalRef.current?.scrollToIndex({ index: clamped, animated: !reducedMotion, viewPosition: 0 });
        } else if (prefs.mode === "paged") {
          const display = prefs.direction === "rtl" ? pages.length - 1 - clamped : clamped;
          pagedRef.current?.scrollToIndex({ index: display, animated: !reducedMotion });
        } else {
          pagedVRef.current?.scrollToIndex({ index: clamped, animated: !reducedMotion });
        }
      } catch {
        // unmeasured list — the failed handler retries
      }
    },
    [pages, prefs.mode, prefs.direction, reducedMotion, beginInteraction],
  );

  // ── chrome / taps ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chrome || !pages || screenReader || listOpen || settingsOpen || jumpOpen) return;
    const timer = setTimeout(() => setChrome(false), 4000);
    return () => clearTimeout(timer);
  }, [chrome, pages, screenReader, listOpen, settingsOpen, jumpOpen]);

  const onTouchStart = useCallback((event: any) => {
    touchRef.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, t: Date.now() };
  }, []);

  const onTouchEnd = useCallback((event: any) => {
    const start = touchRef.current;
    const dx = Math.abs(event.nativeEvent.pageX - start.x);
    const dy = Math.abs(event.nativeEvent.pageY - start.y);
    if (dx < 8 && dy < 8 && Date.now() - start.t < 300) setChrome((visible) => !visible);
  }, []);

  const hideChrome = useCallback(() => setChrome(false), []);
  const handleZoomChange = useCallback((on: boolean) => {
    setZoomed(on);
    if (on) setChrome(false);
  }, []);

  const handlePagedTap = useCallback(
    (zone: "left" | "right" | "center" | "top" | "bottom") => {
      if (zoomedRef.current) return;
      if (zone === "center") {
        setChrome((visible) => !visible);
        return;
      }
      // A page-turn tap is reading, not a request for the UI — keep it hidden
      // unless the tap lands on a dead edge (there the chrome is the feedback).
      setChrome(false);
      let target: number;
      if (prefs.mode === "pagedV") {
        target = zone === "bottom" ? indexRef.current + 1 : indexRef.current - 1;
      } else {
        const forward = prefs.direction === "ltr" ? zone === "right" : zone === "left";
        target = forward ? indexRef.current + 1 : indexRef.current - 1;
      }
      if (target < 0 || target >= (pagesRef.current?.length ?? 0)) {
        setChrome(true);
        return;
      }
      jumpTo(target);
    },
    [prefs.direction, prefs.mode, jumpTo],
  );

  const filteredChapters = useMemo(() => {
    const query = normFuzzy(chapterQuery);
    const number = chapterNumberKey(chapterQuery);
    if (!chapterQuery.trim()) return chapters;
    return chapters.filter(
      (chapter) => (number && chapterNumberKey(chapter.number).includes(number)) || (query && normFuzzy(chapter.title ?? "").includes(query)),
    );
  }, [chapters, chapterQuery]);

  const pagedData = useMemo(() => {
    if (!pages) return [];
    return prefs.direction === "rtl" ? [...pages].reverse() : pages;
  }, [pages, prefs.direction]);

  // Stable identities so VirtualizedList cells don't re-render when only the
  // visible page index changes (progress ticks re-render this whole screen).
  const renderVerticalItem = useCallback(
    ({ item, index: page }: { item: string; index: number }) => (
      <VerticalPage
        page={page}
        headers={imageHeaders}
        onDisplayed={onPageDisplayed}
        uri={item}
        screenWidth={width}
        screenHeight={height}
        fit={prefs.fit}
        dpr={dpr}
        ratioTick={ratioTick}
      />
    ),
    [imageHeaders, onPageDisplayed, width, height, prefs.fit, dpr, ratioTick],
  );
  const maintainVisible = useMemo(() => ({ minIndexForVisible: 0 }), []);

  if (!decoded) {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <MangaState dark
          icon="alert-circle-outline"
          variant="error"
          title={t.mangaLoadError}
          message={t.mangaLoadErrorSub}
          primary={{ label: t.back, onPress: () => router.back(), icon: "arrow-forward" }}
        />
      </View>
    );
  }

  const progressPercent = total > 0 ? ((index + 1) / total) * 100 : 0;
  const currentDisplay = prefs.direction === "rtl" ? total - 1 - index : index;

  return (
    <View style={s.root}>
      <StatusBar hidden={!chrome && !screenReader} style="light" />
      {pages && prefsLoaded && progressReady ? (
        prefs.mode === "vertical" ? (
          <View style={s.listWrap} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <FlatList
              key="manga-vertical"
              ref={verticalRef}
              data={pages}
              extraData={ratioTick}
              keyExtractor={(uri, i) => `${i}:${uri}`}
              renderItem={renderVerticalItem}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              // A page's height changes after its bitmap decodes (placeholder →
              // measured ratio). Without this, changing content above the
              // viewport shifts the raw offset and the reader visibly jumps
              // mid-scroll. RN keeps the first visible item pinned instead.
              maintainVisibleContentPosition={maintainVisible}
              onScrollBeginDrag={() => {
                beginInteraction();
                setChrome(false);
                markScrolling(true);
              }}
              onMomentumScrollBegin={() => markScrolling(true)}
              onScrollEndDrag={() => markScrolling(false)}
              onMomentumScrollEnd={() => markScrolling(false)}
              onScrollToIndexFailed={(info) => {
                verticalRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
                const retry = jumpRetryRef.current;
                if (retry.target !== info.index) { retry.target = info.index; retry.attempts = 0; }
                if (retry.attempts++ >= 4) return;
                if (retry.timer) clearTimeout(retry.timer);
                const restoring = restoringRef.current;
                retry.timer = setTimeout(() => {
                  if (restoring && userInteractedRef.current) return;
                  try { verticalRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0 }); } catch {}
                }, 200);
              }}
              ListFooterComponent={
                <ChapterEnd
                  newer={newerChapter}
                  older={olderChapter}
                  onGo={goToChapter}
                  bottomInset={insets.bottom}
                />
              }
              removeClippedSubviews={true}
              initialNumToRender={1}
              maxToRenderPerBatch={1}
              windowSize={3}
              updateCellsBatchingPeriod={60}
              showsVerticalScrollIndicator={false}
            />
          </View>
        ) : prefs.mode === "paged" ? (
          <GestureDetector gesture={listNative}>
            <FlatList
              key={`manga-paged-${prefs.direction}-${widthRounded}`}
              ref={pagedRef}
              data={pagedData}
              onViewableItemsChanged={onPagedViewableItemsChanged}
              viewabilityConfig={pagedViewabilityConfig}
              horizontal
              pagingEnabled
              scrollEnabled={!zoomed}
              bounces={!zoomed}
              decelerationRate="fast"
              keyExtractor={(uri, i) => `p:${i}:${uri}`}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
              initialScrollIndex={total > 0 ? clamp(prefs.direction === "rtl" ? total - 1 - indexRef.current : indexRef.current, 0, total - 1) : 0}
              renderItem={({ item, index: displayIndex }) => (
                <PagedPage
                  uri={item}
                  page={prefs.mode === "paged" && prefs.direction === "rtl" ? total - 1 - displayIndex : displayIndex}
                  headers={imageHeaders}
                  onDisplayed={onPageDisplayed}
                  width={width}
                  height={height}
                  axis="x"
                  fit={prefs.fit}
                  active={displayIndex === currentDisplay}
                  scrollGesture={listNative}
                  onTapZone={handlePagedTap}
                  onZoomChange={handleZoomChange}
                  onInteract={hideChrome}
                />
              )}
              onScrollToIndexFailed={() => {}}
              onScrollBeginDrag={() => {
                beginInteraction();
                setChrome(false);
              }}
              onMomentumScrollEnd={(event) => {
                const displayIndex = Math.round(event.nativeEvent.contentOffset.x / width);
                const realIndex = prefs.direction === "rtl" ? total - 1 - displayIndex : displayIndex;
                saveRef.current(realIndex, total);
              }}
              initialNumToRender={2}
              maxToRenderPerBatch={2}
              windowSize={3}
              showsHorizontalScrollIndicator={false}
            />
          </GestureDetector>
        ) : (
          <GestureDetector gesture={listNative}>
            <FlatList
              key={`manga-pagedv-${widthRounded}x${Math.round(height)}`}
              ref={pagedVRef}
              data={pages}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={pagedViewabilityConfig}
              pagingEnabled
              scrollEnabled={!zoomed}
              bounces={!zoomed}
              decelerationRate="fast"
              keyExtractor={(uri, i) => `v:${i}:${uri}`}
              getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
              initialScrollIndex={total > 0 ? clamp(indexRef.current, 0, total - 1) : 0}
              renderItem={({ item, index: pageIndex }) => (
                <PagedPage
                  uri={item}
                  page={pageIndex}
                  headers={imageHeaders}
                  onDisplayed={onPageDisplayed}
                  width={width}
                  height={height}
                  axis="y"
                  fit={prefs.fit}
                  active={pageIndex === index}
                  scrollGesture={listNative}
                  onTapZone={handlePagedTap}
                  onZoomChange={handleZoomChange}
                  onInteract={hideChrome}
                />
              )}
              onScrollToIndexFailed={() => {}}
              onScrollBeginDrag={() => {
                beginInteraction();
                setChrome(false);
              }}
              onMomentumScrollEnd={(event) => {
                saveRef.current(Math.round(event.nativeEvent.contentOffset.y / height), total);
              }}
              initialNumToRender={2}
              maxToRenderPerBatch={2}
              windowSize={3}
              showsVerticalScrollIndicator={false}
            />
          </GestureDetector>
        )
      ) : error ? (
        <MangaState dark
          icon="cloud-offline-outline"
          variant="error"
          title={t.mangaChapterError}
          message={t.mangaLoadErrorSub}
          primary={{
            label: t.retry,
            onPress: () => setReloadKey((key) => key + 1),
            icon: "refresh",
          }}
        />
      ) : (
        <View style={s.loading}>
          <ActivityIndicator size="large" color={M.nightAccent} />
          <Text style={s.loadingText}>{t.mangaLoadingChapter}</Text>
        </View>
      )}

      {/* top chrome */}
      {(chrome || screenReader) && (
        <View style={[s.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
                    <Pressable
            style={s.roundBtn}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t.back}
          >
            <Ionicons name="chevron-forward" size={20} color={M.white} />
          </Pressable>
          <View style={s.topInfo}>
            <Text style={s.topTitle} numberOfLines={1}>{mangaTitle}</Text>
            <Text style={s.topSub} numberOfLines={1}>الفصل {chapterNumber}</Text>
          </View>
          <Pressable
            style={s.roundBtn}
            onPress={() => setSettingsOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t.mangaReaderSettings}
          >
            <Ionicons name="options-outline" size={19} color={M.white} />
          </Pressable>
          <View style={s.topProgress}>
            <View style={[s.topProgressFill, { width: `${progressPercent}%` }]} />
          </View>
        </View>
      )}

      {/* bottom chrome */}
      {(chrome || screenReader) && pages && (
        <View style={[s.bottomBar, { paddingBottom: insets.bottom + 10 }]} pointerEvents="box-none">
                    <Pressable
            style={[s.toolBtn, !olderChapter && s.roundBtnDim]}
            disabled={!olderChapter}
            accessibilityState={{ disabled: !olderChapter }}
            onPress={() => olderChapter && goToChapter(olderChapter)}
            accessibilityRole="button"
            accessibilityLabel={t.mangaPrevChapter}
          >
            <Ionicons name="chevron-forward" size={18} color={M.white} />
            <Text style={s.toolLabel}>السابق</Text>
          </Pressable>
          <Pressable
            style={s.toolBtn}
            onPress={() => {
              setChapterQuery("");
              setListOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={t.mangaChaptersList}
          >
            <Ionicons name="list" size={18} color={M.white} />
            <Text style={s.toolLabel}>الفصول</Text>
          </Pressable>
          <Pressable
            style={s.pageIndicator}
            onPress={() => setJumpOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t.mangaPageJump}
          >
            <Text style={s.toolLabel}>الصفحة</Text>
            <Text style={s.pageIndicatorText}>
              {Math.min(index + 1, total)} / {total}
            </Text>
          </Pressable>

          <Pressable
            style={[s.toolBtn, !newerChapter && s.roundBtnDim]}
            disabled={!newerChapter}
            accessibilityState={{ disabled: !newerChapter }}
            onPress={() => newerChapter && goToChapter(newerChapter)}
            accessibilityRole="button"
            accessibilityLabel={t.mangaNextChapter}
          >
            <Ionicons name="chevron-back" size={18} color={M.white} />
            <Text style={s.toolLabel}>التالي</Text>
          </Pressable>
        </View>
      )}

      {/* page jump */}
      <Modal visible={jumpOpen} transparent animationType={reducedMotion ? "none" : "fade"} onRequestClose={() => setJumpOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setJumpOpen(false)} />
        <View style={[s.jumpSheet, { paddingBottom: insets.bottom + 18 }]}>
          <View style={s.sheetHeader}><Pressable style={s.sheetClose} onPress={() => setJumpOpen(false)} accessibilityRole="button" accessibilityLabel={t.cancel}><Ionicons name="close" size={20} color={M.ink} /></Pressable><Text style={s.sheetTitle}>انتقل إلى صفحة</Text></View>
          {jumpOpen && <PageSlider total={total} index={index} onJump={(target) => { setJumpOpen(false); jumpTo(target); }} />}
        </View>
      </Modal>

      {/* chapter sheet */}
      <Modal visible={listOpen} transparent animationType={reducedMotion ? "none" : "fade"} onRequestClose={() => setListOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setListOpen(false)} />
        <KeyboardAvoidingView pointerEvents="box-none" style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={[s.sheet, { paddingBottom: insets.bottom + 8 }]}>
          <View style={s.sheetHeader}>
            <Pressable onPress={() => setListOpen(false)} style={s.sheetClose} accessibilityRole="button" accessibilityLabel={t.cancel}>
              <Ionicons name="close" size={20} color={M.muted} />
            </Pressable>
            <Text style={s.sheetTitle}>{t.mangaChaptersList}</Text>
          </View>
          {chapters.length > 0 && (
            <View style={s.sheetSearch}>
              <Ionicons name="search" size={15} color={M.muted} />
              <TextInput
                value={chapterQuery}
                onChangeText={setChapterQuery}
                placeholder={t.mangaChapterFilter}
                placeholderTextColor={M.muted}
                accessibilityLabel={t.mangaChapterFilter}
                style={s.sheetSearchInput}
              />
            </View>
          )}
          {listOpen && <FlatList
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={s.sheetHint}>{chapterQuery ? "لا توجد فصول مطابقة" : t.loading}</Text>}
            data={filteredChapters}
            keyExtractor={(chapter) => `${chapter.source}:${chapter.id}`}
            renderItem={({ item }) => {
              const read = readSet.has(mangaChapterReadKey(item.source, item.id));
              const active = item.id === chapterId && item.source === chapterSource;
              return (
                <View>
                  <ChapterRow
                    number={item.number}
                    title={item.title}
                    date={item.date}
                    read={read}
                    active={active}
                    onPress={() => {
                      setListOpen(false);
                      if (!active) goToChapter(item);
                    }}
                    onLongPress={() =>
                      void setMangaChapterRead(
                        source,
                        mangaId,
                        mangaChapterReadKey(item.source, item.id),
                        !read,
                      )
                    }
                  />
                  {active && <Text style={s.readingNow}>{t.mangaReadingNow}</Text>}
                </View>
              );
            }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16 }}
            initialNumToRender={18}
            windowSize={9}
            removeClippedSubviews
          />}
          <Text style={s.sheetHint}>{t.mangaReadHint}</Text>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* settings sheet */}
      <Modal visible={settingsOpen} transparent animationType={reducedMotion ? "none" : "fade"} onRequestClose={() => setSettingsOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setSettingsOpen(false)} />
        <View style={[s.settingsSheet, { paddingBottom: insets.bottom + 18 }]}>
          <View style={s.sheetHeader}>
            <Pressable onPress={() => setSettingsOpen(false)} style={s.sheetClose} accessibilityRole="button" accessibilityLabel={t.cancel}>
              <Ionicons name="close" size={20} color={M.muted} />
            </Pressable>
            <Text style={s.sheetTitle}>{t.mangaReaderSettings}</Text>
          </View>

          {/* Scrollable body: six fit chips + three choice rows overflow short
              screens; the sheet is capped so it can never run off the top.
              Built only while the sheet is open so page-progress re-renders
              don't reconcile the whole chip grid. */}
          {settingsOpen && <ScrollView
            style={s.settingsScroll}
            contentContainerStyle={s.settingsBody}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <SettingBlock label={t.mangaReaderMode}>
              <ChoiceChip
                label={t.mangaReaderVertical}
                icon="swap-vertical"
                active={prefs.mode === "vertical"}
                onPress={() => setPrefs((p) => ({ ...p, mode: "vertical" }))}
              />
              <ChoiceChip
                label={t.mangaReaderPaged}
                icon="albums-outline"
                active={prefs.mode === "paged"}
                onPress={() => setPrefs((p) => ({ ...p, mode: "paged" }))}
              />
              <ChoiceChip
                label={t.mangaReaderPagedV}
                icon="layers-outline"
                active={prefs.mode === "pagedV"}
                onPress={() => setPrefs((p) => ({ ...p, mode: "pagedV" }))}
              />
            </SettingBlock>

            {prefs.mode === "paged" && <SettingBlock label={t.mangaDirection}>
              <ChoiceChip
                label={t.mangaDirectionRtl}
                active={prefs.direction === "rtl"}
                onPress={() => setPrefs((p) => ({ ...p, direction: "rtl" }))}
              />
              <ChoiceChip
                label={t.mangaDirectionLtr}
                active={prefs.direction === "ltr"}
                onPress={() => setPrefs((p) => ({ ...p, direction: "ltr" }))}
              />
            </SettingBlock>}

            <SettingBlock label={t.mangaRotation}>
              <ChoiceChip
                label={t.mangaRotationAuto}
                active={prefs.rotation === "auto"}
                onPress={() => setPrefs((p) => ({ ...p, rotation: "auto" }))}
              />
              <ChoiceChip
                label={t.mangaRotationLocked}
                active={prefs.rotation === "locked"}
                onPress={() => setPrefs((p) => ({ ...p, rotation: "locked" }))}
              />
            </SettingBlock>

            <SettingBlock label={t.mangaReaderFit}>
              {prefs.mode !== "vertical" ? (<>
                <ChoiceChip label={t.mangaFitScreen} active={prefs.fit !== "stretch"} onPress={() => setPrefs((p) => ({ ...p, fit: "screen" }))} />
                <ChoiceChip label={t.mangaFitStretch} active={prefs.fit === "stretch"} onPress={() => setPrefs((p) => ({ ...p, fit: "stretch" }))} />
              </>) : (<>
              <ChoiceChip
                label={t.mangaFitWidth}
                active={prefs.fit === "width"}
                onPress={() => setPrefs((p) => ({ ...p, fit: "width" }))}
              />
              <ChoiceChip
                label={t.mangaFitScreen}
                active={prefs.fit === "screen"}
                onPress={() => setPrefs((p) => ({ ...p, fit: "screen" }))}
              />
              <ChoiceChip
                label={t.mangaFitHeight}
                active={prefs.fit === "height"}
                onPress={() => setPrefs((p) => ({ ...p, fit: "height" }))}
              />
              <ChoiceChip
                label={t.mangaFitStretch}
                active={prefs.fit === "stretch"}
                onPress={() => setPrefs((p) => ({ ...p, fit: "stretch" }))}
              />
              <ChoiceChip
                label={t.mangaFitOriginal}
                active={prefs.fit === "original"}
                onPress={() => setPrefs((p) => ({ ...p, fit: "original" }))}
              />
              <ChoiceChip
                label={t.mangaFitSmart}
                active={prefs.fit === "smart"}
                onPress={() => setPrefs((p) => ({ ...p, fit: "smart" }))}
              />
              </>)}
            </SettingBlock>
          </ScrollView>}
        </View>
      </Modal>
    </View>
  );
}

// ── pages ────────────────────────────────────────────────────────────────────

/** Zoomable full-screen page for the paged modes. Pinch (1×–4×), pan while
 * zoomed, tap zones; `blocksExternalGesture` keeps the native list scroll from
 * stealing the pinch on Android. No double-tap zoom — pinch only. */
const PagedPage = memo(function PagedPage({
  uri,
  page,
  headers,
  onDisplayed,
  width,
  height,
  axis,
  fit,
  active,
  scrollGesture,
  onTapZone,
  onZoomChange,
  onInteract,
}: {
  uri: string;
  page: number;
  headers: Record<string, string>;
  onDisplayed: (uri: string) => void;
  width: number;
  height: number;
  axis: "x" | "y";
  fit: FitMode;
  active: boolean;
  scrollGesture: unknown;
  onTapZone: (zone: "left" | "right" | "center" | "top" | "bottom") => void;
  onZoomChange: (zoomed: boolean) => void;
  onInteract: () => void;
}) {
  const scale = useSharedValue(1);
  const baseScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const baseX = useSharedValue(0);
  const baseY = useSharedValue(0);
  // Shared zoom flag: worklets read it synchronously, so a pan that starts the
  // instant a pinch ends still knows the page is zoomed (React state lags).
  const zoomFlag = useSharedValue(false);
  const zoomedRef = useRef(false);
  const [ratio, setRatio] = useState(() => ratioCache.get(uri) ?? 1.5);
  const [naturalWidth, setNaturalWidth] = useState(() => naturalWidthCache.get(uri) ?? 0);

  const setZoom = useCallback(
    (on: boolean) => {
      zoomFlag.value = on;
      zoomedRef.current = on;
      onZoomChange(on);
    },
    [onZoomChange, zoomFlag],
  );

  // Leaving the page always resets its transform — no sticky zoom.
  useEffect(() => {
    if (active) return;
    zoomFlag.value = false;
    scale.value = withTiming(1);
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    if (zoomedRef.current) setZoom(false);
  }, [active, scale, tx, ty, setZoom, zoomFlag]);

  // Fitted (visible) image box at scale 1 — pan/zoom clamps use it so the
  // artwork can never be dragged into the letterbox void.
  const fitted = useMemo(() => {
    if (fit === "stretch") return { dw: width, dh: height };
    const r = ratio;
    let dw = width;
    let dh = width * r;
    if (dh > height) {
      dh = height;
      dw = height / r;
    }
    return { dw, dh };
  }, [ratio, width, height, fit]);


  // Pinch = the ONLY zoom input (1×–4×). `blocksExternalGesture` keeps the
  // native list from stealing the two-finger gesture on Android; the zoom flag
  // flips as soon as the scale crosses 1.05 so the list disables mid-pinch.
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .blocksExternalGesture(scrollGesture as never)
        .onStart(() => {
          baseScale.value = scale.value;
          runOnJS(onInteract)();
        })
        .onUpdate((event) => {
          scale.value = clamp(baseScale.value * event.scale, 1, 4);
          const maxX = Math.max(0, (scale.value * fitted.dw - width) / 2);
          const maxY = Math.max(0, (scale.value * fitted.dh - height) / 2);
          tx.value = clamp(tx.value, -maxX, maxX);
          ty.value = clamp(ty.value, -maxY, maxY);
          if (scale.value > 1.05 && !zoomFlag.value) {
            zoomFlag.value = true;
            runOnJS(setZoom)(true);
          }
        })
        .onEnd(() => {
          // Read the shared flag, never the React ref — refs are captured at
          // gesture creation and go stale on the UI thread (zoom-out would
          // latch scrollEnabled=false).
          if (scale.value <= 1.05) {
            scale.value = withTiming(1);
            tx.value = withTiming(0);
            ty.value = withTiming(0);
            if (zoomFlag.value) runOnJS(setZoom)(false);
          } else if (!zoomFlag.value) {
            runOnJS(setZoom)(true);
          }
        }),
    [baseScale, scale, tx, ty, setZoom, scrollGesture, zoomFlag, onInteract, fitted, width, height],
  );

  // One-finger pan. Manual activation gates it on the LIVE zoom flag instead of
  // React state: when the page is at 1× the gesture fails on the first move so
  // the native list still swipes pages; when zoomed it activates and drags the
  // artwork. `.maxPointers(1)` keeps two-finger input for the pinch alone.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .manualActivation(true)
        .onTouchesMove((_event, state) => {
          if (scale.value > 1.01) state.activate();
          else state.fail();
        })
        .onStart(() => {
          baseX.value = tx.value;
          baseY.value = ty.value;
          runOnJS(onInteract)();
        })
        .onUpdate((event) => {
          const maxX = Math.max(0, (scale.value * fitted.dw - width) / 2);
          const maxY = Math.max(0, (scale.value * fitted.dh - height) / 2);
          tx.value = clamp(baseX.value + event.translationX, -maxX, maxX);
          ty.value = clamp(baseY.value + event.translationY, -maxY, maxY);
        }),
    [fitted, width, height, baseX, baseY, scale, tx, ty, onInteract],
  );

  const singleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .maxDuration(250)
        .onEnd((event, success) => {
          if (!success) return;
          if (axis === "x") {
            if (event.x < width / 3) runOnJS(onTapZone)("left");
            else if (event.x > (width * 2) / 3) runOnJS(onTapZone)("right");
            else runOnJS(onTapZone)("center");
          } else {
            if (event.y < height / 3) runOnJS(onTapZone)("top");
            else if (event.y > (height * 2) / 3) runOnJS(onTapZone)("bottom");
            else runOnJS(onTapZone)("center");
          }
        }),
    [axis, width, height, onTapZone],
  );

  const composed = useMemo(
    () => Gesture.Simultaneous(pinch, pan, singleTap),
    [pinch, pan, singleTap],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={composed}>
      <View style={{ width, height, overflow: "hidden", backgroundColor: M.night }} collapsable={false}>
        <Animated.View style={[MANGA_FILL, animatedStyle]}>
          <MangaPageImage key={uri} uri={uri} page={page} headers={headers} contentFit={fit === "stretch" ? "fill" : "contain"}
            fullResolution={naturalWidth > 0 && naturalWidth * naturalWidth * ratio < 16_000_000 && naturalWidth * ratio < 8192}
            onDisplayed={onDisplayed}
            onMeasure={(event) => {
              const { width: w, height: h } = event.source;
              if (w > 0 && h > 0) {
                rememberRatio(uri, h / w);
                noteNaturalWidth(uri, w);
                setRatio(h / w);
                setNaturalWidth(w);
              }
            }} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
});

/** Continuous-mode page. Intrinsic size comes from the <Image>'s own onLoad
 * event (no `useImage` — holding a decoded full-res ref per windowed cell is
 * an OOM risk on mid-range devices), with the persisted ratio cache providing
 * the exact container before the bitmap arrives. */
const VerticalPage = memo(function VerticalPage({ uri, page, headers, onDisplayed, screenWidth, screenHeight, fit, dpr, ratioTick }: {
  uri: string; page: number; headers: Record<string, string>; onDisplayed: (uri: string) => void;
  screenWidth: number; screenHeight: number; fit: FitMode; dpr: number; ratioTick: number;
}) {
  const [ratio, setRatio] = useState(() => ratioCache.get(uri) ?? recentRatio);
  useEffect(() => { setRatio(ratioCache.get(uri) ?? recentRatio); }, [uri, ratioTick]);
  const dims = ratio > 0
    ? verticalDims(fit, screenWidth, screenHeight, ratio, naturalWidthCache.get(uri) ?? 0, dpr)
    : { width: screenWidth, height: screenWidth * 1.45, contentFit: "contain" as const };
  const decodeSize = useMemo(() => verticalDecodeSize(screenWidth, dpr), [screenWidth, dpr]);
  return (
    <View style={{ width: dims.width, height: dims.height, alignSelf: "center", backgroundColor: M.night }}>
      <MangaPageImage key={uri} uri={uri} page={page} headers={headers} contentFit={dims.contentFit} onDisplayed={onDisplayed}
        decodeSize={fit === "width" || fit === "smart" ? decodeSize : undefined}
        onMeasure={(event) => {
          const { width: w, height: h } = event.source;
          if (w > 0 && h > 0) {
            rememberRatio(uri, h / w);
            noteNaturalWidth(uri, w);
            setRatio(h / w);
          }
        }} />
    </View>
  );
});

function ChapterEnd({
  newer,
  older,
  onGo,
  bottomInset,
}: {
  newer: MergedChapter | null;
  older: MergedChapter | null;
  onGo: (chapter: MergedChapter) => void;
  bottomInset: number;
}) {
  return (
    <View style={[s.endBlock, { paddingBottom: bottomInset + 100 }]}>
      <View style={s.endDisc}>
        <Ionicons name="checkmark-done" size={26} color={M.nightAccent} />
      </View>
      <Text style={s.endTitle}>{t.mangaFinishedChapter}</Text>
      {newer ? (
        <Pressable style={s.endBtn} onPress={() => onGo(newer)} accessibilityRole="button">
          <Text style={s.endBtnText}>{t.mangaNextChapter} • الفصل {newer.number}</Text>
          <Ionicons name="chevron-back" size={16} color={M.white} />
        </Pressable>
      ) : (
        <Text style={s.endSub}>{t.mangaNoNewer}</Text>
      )}
      {older ? (
        <Pressable style={s.endBtnGhost} onPress={() => onGo(older)} accessibilityRole="button">
          <Text style={s.endBtnGhostText}>{t.mangaPrevChapter} • الفصل {older.number}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── controls ─────────────────────────────────────────────────────────────────

/** Drag/tap track to seek. Pure JS (PanResponder) — no slider dependency. */
function PageSlider({
  total,
  index,
  onJump,
}: {
  total: number;
  index: number;
  onJump: (target: number) => void;
}) {
  const [trackW, setTrackW] = useState(0);
  const [pos, setPos] = useState<number | null>(null);
  const posRef = useRef<number | null>(null);
  const trackWRef = useRef(0);
  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;
  trackWRef.current = trackW;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const x = clamp(event.nativeEvent.locationX, 0, trackWRef.current);
          posRef.current = x;
          setPos(x);
        },
        onPanResponderMove: (event) => {
          const x = clamp(event.nativeEvent.locationX, 0, trackWRef.current);
          posRef.current = x;
          setPos(x);
        },
        onPanResponderRelease: () => {
          const width = trackWRef.current;
          const x = posRef.current ?? 0;
          posRef.current = null;
          setPos(null);
          if (width > 0 && total > 1) onJumpRef.current(Math.round((x / width) * (total - 1)));
        },
        onPanResponderTerminate: () => {
          posRef.current = null;
          setPos(null);
        },
      }),
    [total],
  );

  const baseX = total > 1 && trackW > 0 ? (index / (total - 1)) * trackW : 0;
  const displayX = pos ?? baseX;
  const preview = pos != null && trackW > 0
    ? Math.round((pos / trackW) * (total - 1)) + 1
    : Math.min(index + 1, total);

  return (
    <View style={s.sliderWrap}>
      <Text style={s.sliderNumber}>{preview}<Text style={s.sliderTotal}> / {total}</Text></Text>
      <Text style={s.sliderLabel}>اسحب المؤشر لاختيار الصفحة</Text>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t.mangaPageJump}
        accessibilityValue={{ min: 1, max: Math.max(1, total), now: preview }}
        accessibilityActions={[{ name: "increment", label: "الصفحة التالية" }, { name: "decrement", label: "الصفحة السابقة" }]}
        onAccessibilityAction={(event) => onJump(clamp(index + (event.nativeEvent.actionName === "increment" ? 1 : -1), 0, Math.max(0, total - 1)))}
        style={s.sliderTrack}
        onLayout={(event) => setTrackW(event.nativeEvent.layout.width)}
        {...responder.panHandlers}
      >
        <View pointerEvents="none" style={s.sliderRail} />
        <View pointerEvents="none" style={[s.sliderFill, { width: displayX }]} />
        <View pointerEvents="none" style={[s.sliderThumb, { left: clamp(displayX - 9, 0, Math.max(0, trackW - 18)) }]} />
      </View>
    </View>
  );
}

function SettingBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={s.settingBlock}>
      <Text style={s.settingLabel}>{label}</Text>
      <View style={s.settingChoicesWrap}>{children}</View>
    </View>
  );
}

function ChoiceChip({ label, active, onPress, icon }: { label: string; active: boolean; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [s.choiceChip, active && s.choiceChipActive, pressed && { opacity: 0.7 }]}
    >
      {icon && <Ionicons name={icon} size={18} color={active ? M.white : M.muted} />}
      <Text style={[s.choiceChipText, active && s.choiceChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: M.night },
  listWrap: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  loadingText: { ...MT.body, color: M.nightMuted },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row-reverse", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: M.night },
  topInfo: { flex: 1, alignItems: "flex-end", minWidth: 0 },
  topTitle: { ...MT.label, color: M.white, textAlign: "right" },
  topSub: { ...MT.caption, color: M.nightAccent, textAlign: "right" },
  topProgress: { position: "absolute", bottom: 0, left: 0, right: 0, height: 3, backgroundColor: M.nightLine, alignItems: "flex-end" },
  topProgressFill: { height: 3, backgroundColor: M.nightAccent },
  roundBtn: { minWidth: 48, minHeight: 48, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: M.nightPanel },
  roundBtnDim: { opacity: 0.35 },
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row-reverse", alignItems: "stretch", justifyContent: "space-between", gap: 6, paddingHorizontal: 12, paddingTop: 12, backgroundColor: M.night, borderTopWidth: 1, borderColor: M.nightLine },
  toolBtn: { flex: 1, minWidth: 48, minHeight: 56, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: M.nightPanel },
  toolLabel: { ...MT.caption, fontSize: 11, color: M.nightMuted },
  pageIndicator: { minHeight: 56, flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 6, paddingVertical: 4, borderRadius: 4, backgroundColor: M.nightPanel },
  pageIndicatorText: { ...MT.number, color: M.nightAccent },
  endBlock: { alignItems: "center", gap: 14, paddingHorizontal: 24, paddingTop: 40, backgroundColor: M.night },
  endDisc: { width: 64, height: 64, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: M.nightPanel, borderWidth: 1, borderColor: M.nightLine },
  endTitle: { ...MT.heading, color: M.white, textAlign: "center" },
  endSub: { ...MT.body, color: M.nightMuted, textAlign: "center" },
  endBtn: { minHeight: 52, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: M.accent, borderRadius: 4, paddingHorizontal: 20, paddingVertical: 12 },
  endBtnText: { ...MT.label, color: M.white, flexShrink: 1, textAlign: "center" },
  endBtnGhost: { minHeight: 48, justifyContent: "center", borderRadius: 4, borderWidth: 1, borderColor: M.nightLine, backgroundColor: M.nightPanel, paddingHorizontal: 18, paddingVertical: 10 },
  endBtnGhostText: { ...MT.caption, color: M.nightMuted, textAlign: "center" },
  modalBackdrop: { ...MANGA_FILL, backgroundColor: M.scrim },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "82%", backgroundColor: M.paper, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  settingsSheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "88%", backgroundColor: M.paper, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  settingsScroll: { flexShrink: 1 },
  settingsBody: { paddingBottom: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 12, borderBottomWidth: 1, borderColor: M.line },
  sheetClose: { width: 48, height: 48, borderRadius: 4, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: M.line, backgroundColor: M.sheet },
  sheetTitle: { ...MT.heading, flexShrink: 1, color: M.ink, textAlign: "right" },
  sheetSearch: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 20, marginVertical: 12, minHeight: 56, paddingHorizontal: 12, borderRadius: 4, backgroundColor: M.sheet, borderWidth: 1, borderColor: M.line },
  sheetSearchInput: { ...MT.body, flex: 1, minWidth: 0, color: M.ink, textAlign: "right", paddingVertical: 12 },
  readingNow: { ...MT.caption, color: M.accent, textAlign: "right", marginTop: 4, marginRight: 4 },
  sheetHint: { ...MT.caption, color: M.muted, textAlign: "center", paddingVertical: 10, paddingHorizontal: 20 },
  jumpSheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: M.paper, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  sliderWrap: { paddingHorizontal: 28, paddingTop: 24, gap: 8 },
  sliderNumber: { ...MT.number, fontSize: 36, lineHeight: 46, color: M.accent, textAlign: "center" },
  sliderTotal: { ...MT.number, fontSize: 18, color: M.muted },
  sliderLabel: { ...MT.body, color: M.muted, textAlign: "center" },
  sliderTrack: { minHeight: 56, justifyContent: "center" },
  sliderRail: { position: "absolute", left: 0, right: 0, height: 4, backgroundColor: M.line },
  sliderFill: { position: "absolute", left: 0, height: 4, backgroundColor: M.accent },
  sliderThumb: { position: "absolute", width: 18, height: 24, borderRadius: 4, backgroundColor: M.accent, borderWidth: 2, borderColor: M.sheet },
  settingBlock: { paddingHorizontal: 20, paddingVertical: 18, alignItems: "flex-end", gap: 12, borderBottomWidth: 1, borderColor: M.line },
  settingLabel: { ...MT.label, color: M.ink },
  settingChoicesWrap: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  choiceChip: { minHeight: 48, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 4, backgroundColor: M.sheet, borderWidth: 1, borderColor: M.line },
  choiceChipActive: { backgroundColor: M.ink, borderColor: M.ink },
  choiceChipText: { ...MT.label, color: M.muted, flexShrink: 1 },
  choiceChipTextActive: { color: M.white },
});
