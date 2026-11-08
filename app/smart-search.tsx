// Smart (AI) search — its own screen, separate from the normal title search.
// The user describes what they feel like watching (any dialect); the
// companion edge function turns it into real titles, resolved via AniList.

import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Aurora, ScreenHeader } from "../components/ScreenChrome";
import { AniListPosterCard } from "../components/AniListPosterCard";
import { StateView } from "../components/StateView";
import { AI_SEARCH_MAX_PAGE, aiSearch, type AiSearchEntry } from "../lib/aiSearch";
import { C, R } from "../lib/theme";
import { t } from "../lib/i18n";

const EXAMPLES = [
  "أنمي رومانسي مدرسي خفيف ومضحك",
  "قتال قوي وبطل يبدأ ضعيفًا ويصبح الأقوى",
  "غموض ونفسي يخليني أفكر",
  "أنمي قصير أكمله في يوم",
  "إيسيكاي فيه نظام لفلات",
];

const POSTER_W = 104;

export default function SmartSearchScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string }>();
  const [text, setText] = useState(typeof params.q === "string" ? params.q : "");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [items, setItems] = useState<AiSearchEntry[]>([]);
  const [intent, setIntent] = useState("");
  const [error, setError] = useState("");
  // "Show more" paging: the query the results belong to, the last page
  // loaded, and the footer state (idle / loading / exhausted / error).
  const [page, setPage] = useState(1);
  const [lastQuery, setLastQuery] = useState("");
  const [more, setMore] = useState<"idle" | "loading" | "end" | "error">("idle");
  const seq = useRef(0);

  const failText = (reason: string) =>
    reason === "signin" ? t.companionSignIn
      : reason === "rate_limited" ? t.companionRateLimited
      : reason === "unavailable" ? t.companionUnavailable
      : reason === "empty" ? t.aiSearchEmpty
      : t.companionError;

  const run = useCallback(async (value?: string) => {
    const q = (value ?? text).trim();
    if (q.length < 2) return;
    if (value != null) setText(value);
    Keyboard.dismiss();
    const my = ++seq.current;
    setState("loading");
    setError("");
    setMore("idle");
    setPage(1);
    setLastQuery(q);
    const res = await aiSearch(q);
    if (my !== seq.current) return;
    if (res.ok) {
      setItems(res.items);
      setIntent(res.intent);
      setState(res.items.length ? "done" : "error");
      if (!res.items.length) setError(t.aiSearchEmpty);
    } else {
      setError(failText(res.reason));
      setState("error");
    }
  }, [text]);

  const loadMore = useCallback(async () => {
    if (state !== "done" || more === "loading" || more === "end" || !lastQuery) return;
    if (page >= AI_SEARCH_MAX_PAGE) { setMore("end"); return; }
    const my = seq.current;
    const next = page + 1;
    setMore("loading");
    const res = await aiSearch(lastQuery, { page: next, exclude: items.map((it) => it.title) });
    if (my !== seq.current) return;
    if (!res.ok) {
      setMore(res.reason === "empty" ? "end" : "error");
      if (res.reason !== "empty") setError(failText(res.reason));
      return;
    }
    const have = new Set(items.map((it) => it.anilistId));
    const fresh = res.items.filter((it) => !have.has(it.anilistId));
    setPage(next);
    if (!fresh.length) { setMore("end"); return; }
    setItems((prev) => [...prev, ...fresh]);
    setMore(next >= AI_SEARCH_MAX_PAGE ? "end" : "idle");
  }, [state, more, lastQuery, page, items]);

  const canRun = text.trim().length >= 2 && state !== "loading";

  const header = (
    <View>
      <Text style={ss.intro}>{t.smartSearchIntro}</Text>
      <View style={ss.box}>
        <TextInput
          style={ss.input}
          value={text}
          onChangeText={setText}
          placeholder={t.smartSearchPlaceholder}
          placeholderTextColor={C.textMuted}
          multiline
          maxLength={300}
          textAlign="right"
          textAlignVertical="top"
          selectionColor={C.accent}
          accessibilityLabel={t.smartSearchPlaceholder}
        />
        <Pressable
          onPress={() => run()}
          disabled={!canRun}
          style={({ pressed }) => [ss.runBtn, !canRun && { opacity: 0.45 }, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel={t.smartSearchRun}
        >
          {state === "loading"
            ? <ActivityIndicator size="small" color={C.textOnAccent} />
            : <Ionicons name="sparkles" size={16} color={C.textOnAccent} />}
          <Text style={ss.runText}>{state === "loading" ? t.aiSearchThinking : t.smartSearchRun}</Text>
        </Pressable>
      </View>

      {state === "idle" && (
        <View style={ss.examples}>
          <Text style={ss.examplesLabel}>{t.smartSearchExamples}</Text>
          {EXAMPLES.map((ex) => (
            <Pressable
              key={ex}
              onPress={() => run(ex)}
              style={({ pressed }) => [ss.example, pressed && { opacity: 0.75 }]}
              accessibilityRole="button"
            >
              <Ionicons name="sparkles-outline" size={14} color={C.accent} />
              <Text style={ss.exampleText} numberOfLines={1}>{ex}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {state === "error" && (
        <View style={ss.errorWrap}>
          <StateView
            icon="sparkles-outline"
            variant="empty"
            title={error || t.companionError}
            primary={{ label: t.retry, onPress: () => run(), icon: "refresh" }}
          />
        </View>
      )}

      {state === "done" && (
        <View style={ss.resultsHead}>
          <Text style={ss.resultsTitle}>{t.aiSearchResults}</Text>
          {intent ? <Text style={ss.resultsSub}>{intent}</Text> : null}
        </View>
      )}
    </View>
  );

  return (
    <View style={[ss.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.aiSearchTitle} />
      <FlatList
        data={state === "done" ? items : []}
        keyExtractor={(it) => String(it.anilistId)}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListFooterComponent={state === "done" && items.length ? (
          <View style={ss.moreWrap}>
            {more === "end" ? (
              <Text style={ss.moreEnd}>{t.aiSearchNoMore}</Text>
            ) : (
              <>
                {more === "error" && error ? <Text style={ss.moreEnd}>{error}</Text> : null}
                <Pressable
                  onPress={loadMore}
                  disabled={more === "loading"}
                  style={({ pressed }) => [ss.moreBtn, pressed && { opacity: 0.8 }]}
                  accessibilityRole="button"
                  accessibilityLabel={t.aiSearchMore}
                >
                  {more === "loading"
                    ? <ActivityIndicator size="small" color={C.accent} />
                    : <Ionicons name={more === "error" ? "refresh" : "sparkles-outline"} size={16} color={C.accent} />}
                  <Text style={ss.moreText}>
                    {more === "loading" ? t.aiSearchMoreLoading : more === "error" ? t.retry : t.aiSearchMore}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}
        renderItem={({ item }) => (
          <View style={ss.row}>
            <AniListPosterCard entry={item} width={POSTER_W} titleLines={2} />
            <View style={ss.rowText}>
              <Text style={ss.rowTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={ss.meta} numberOfLines={1}>
                {[item.year, item.score ? `★ ${(item.score / 10).toFixed(1)}` : null, item.episodes ? t.episodeCount(item.episodes) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {item.reason ? <Text style={ss.reason} numberOfLines={5}>{item.reason}</Text> : null}
            </View>
          </View>
        )}
      />
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  intro: { color: C.textSecondary, fontSize: 13, lineHeight: 22, fontFamily: "Cairo_500Medium", textAlign: "right", marginTop: 4, marginBottom: 12 },
  box: {
    borderRadius: R.lg, padding: 12,
    backgroundColor: "rgba(139,147,255,0.08)", borderWidth: 1, borderColor: "rgba(139,147,255,0.32)",
  },
  input: { minHeight: 96, color: C.text, fontSize: 15, lineHeight: 24, fontFamily: "Cairo_500Medium", padding: 0 },
  runBtn: {
    direction: "ltr", flexDirection: "row-reverse", alignItems: "center", justifyContent: "center",
    height: 46, borderRadius: R.pill, backgroundColor: C.accent, marginTop: 10,
  },
  runText: { color: C.textOnAccent, fontSize: 14, fontFamily: "Cairo_700Bold", marginRight: 8 },
  examples: { marginTop: 18 },
  examplesLabel: { color: C.textMuted, fontSize: 12, fontFamily: "Cairo_700Bold", textAlign: "right", marginBottom: 8 },
  example: {
    direction: "ltr", flexDirection: "row-reverse", alignItems: "center",
    paddingHorizontal: 14, height: 44, borderRadius: R.md, marginBottom: 8,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderSoft,
  },
  exampleText: { flex: 1, color: C.text, fontSize: 13, fontFamily: "Cairo_500Medium", textAlign: "right", marginRight: 8 },
  errorWrap: { marginTop: 24 },
  resultsHead: { marginTop: 18, marginBottom: 6 },
  resultsTitle: { color: C.text, fontSize: 16, fontFamily: "Cairo_700Bold", textAlign: "right" },
  resultsSub: { color: C.textMuted, fontSize: 12, fontFamily: "Cairo_500Medium", textAlign: "right" },
  row: { direction: "ltr", flexDirection: "row-reverse", alignItems: "flex-start", marginTop: 14 },
  rowText: { flex: 1, marginRight: 12 },
  rowTitle: { color: C.text, fontSize: 15, fontFamily: "Cairo_700Bold", textAlign: "right" },
  meta: { color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium", textAlign: "right", marginTop: 2 },
  reason: { color: C.textSecondary, fontSize: 12, lineHeight: 20, fontFamily: "Cairo_500Medium", textAlign: "right", marginTop: 6 },
  moreWrap: { marginTop: 22, alignItems: "stretch" },
  moreBtn: {
    direction: "ltr", flexDirection: "row-reverse", alignItems: "center", justifyContent: "center",
    height: 46, borderRadius: R.pill,
    backgroundColor: "rgba(139,147,255,0.10)", borderWidth: 1, borderColor: "rgba(139,147,255,0.36)",
  },
  moreText: { color: C.accent, fontSize: 14, fontFamily: "Cairo_700Bold", marginRight: 8 },
  moreEnd: { color: C.textMuted, fontSize: 12, fontFamily: "Cairo_500Medium", textAlign: "center", marginBottom: 10 },
});
