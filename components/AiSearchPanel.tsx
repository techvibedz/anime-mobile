// Smart (AI) search panel for the Discover tab.
//
// States: a one-tap suggestion when the text reads like a description, a
// "thinking" row, a horizontal rail of AniList-resolved results (each with the
// AI's one-line reason), or an inline error with retry. Cards open through
// AniListPosterCard, so a tap resolves the title to a playable source page.

import { memo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AniListPosterCard } from "./AniListPosterCard";
import { RtlRow } from "./RtlRow";
import { C, R } from "../lib/theme";
import { t } from "../lib/i18n";
import type { AiSearchEntry } from "../lib/aiSearchCore";

export type AiPanelState = "suggest" | "loading" | "done" | "error";

const CARD_W = 118;

export const AiSearchPanel = memo(function AiSearchPanel({
  state,
  query,
  intent,
  items,
  errorText,
  onRun,
  onClose,
}: {
  state: AiPanelState;
  query: string;
  intent?: string;
  items?: AiSearchEntry[];
  errorText?: string;
  onRun: () => void;
  onClose: () => void;
}) {
  if (state === "suggest") {
    return (
      <Pressable
        onPress={onRun}
        style={({ pressed }) => [ss.suggest, pressed && { opacity: 0.8 }]}
        accessibilityRole="button"
        accessibilityLabel={t.aiSearchSuggest(query)}
      >
        <View style={ss.sparkle}>
          <Ionicons name="sparkles" size={16} color={C.accent} />
        </View>
        <View style={ss.suggestText}>
          <Text style={ss.suggestTitle} numberOfLines={1}>{t.aiSearchTitle}</Text>
          <Text style={ss.suggestSub} numberOfLines={1}>{t.aiSearchSuggest(query)}</Text>
        </View>
        <Ionicons name="chevron-back" size={16} color={C.textMuted} />
      </Pressable>
    );
  }

  if (state === "loading") {
    return (
      <View style={ss.status} accessibilityRole="progressbar" accessibilityLabel={t.aiSearchThinking}>
        <ActivityIndicator size="small" color={C.accent} />
        <Text style={ss.statusText}>{t.aiSearchThinking}</Text>
      </View>
    );
  }

  if (state === "error") {
    return (
      <View style={ss.status}>
        <Text style={ss.errorText} numberOfLines={2}>{errorText || t.companionError}</Text>
        <Pressable onPress={onRun} style={ss.retry} accessibilityRole="button">
          <Text style={ss.retryText}>{t.retry}</Text>
        </Pressable>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t.close}>
          <Ionicons name="close" size={16} color={C.textMuted} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={ss.done}>
      <View style={ss.head}>
        <View style={ss.sparkle}>
          <Ionicons name="sparkles" size={16} color={C.accent} />
        </View>
        <View style={ss.suggestText}>
          <Text style={ss.suggestTitle} numberOfLines={1}>{t.aiSearchResults}</Text>
          {intent ? <Text style={ss.suggestSub} numberOfLines={1}>{intent}</Text> : null}
        </View>
        <Pressable onPress={onClose} hitSlop={10} style={ss.close} accessibilityRole="button" accessibilityLabel={t.close}>
          <Ionicons name="close" size={16} color={C.textMuted} />
        </Pressable>
      </View>
      <RtlRow contentContainerStyle={ss.rail} keyboardShouldPersistTaps="handled">
        {(items ?? []).map((item) => (
          <View key={item.anilistId} style={ss.cardCol}>
            <AniListPosterCard
              entry={item}
              width={CARD_W}
              titleLines={2}
            />
            <Text style={ss.meta} numberOfLines={1}>
              {[item.year, item.score ? `★ ${(item.score / 10).toFixed(1)}` : null, item.episodes ? t.episodeCount(item.episodes) : null]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {item.reason ? <Text style={ss.reason} numberOfLines={3}>{item.reason}</Text> : null}
          </View>
        ))}
      </RtlRow>
    </View>
  );
});

const ss = StyleSheet.create({
  suggest: {
    direction: "ltr", flexDirection: "row-reverse", alignItems: "center",
    marginHorizontal: 16, marginTop: 10, marginBottom: 4,
    paddingHorizontal: 12, minHeight: 56, borderRadius: R.lg,
    backgroundColor: "rgba(139,147,255,0.08)", borderWidth: 1, borderColor: "rgba(139,147,255,0.32)",
  },
  sparkle: {
    width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(139,147,255,0.16)", marginLeft: 10,
  },
  suggestText: { flex: 1, alignItems: "flex-end" },
  suggestTitle: { color: C.text, fontSize: 14, fontFamily: "Cairo_700Bold", textAlign: "right" },
  suggestSub: { color: C.textMuted, fontSize: 12, fontFamily: "Cairo_500Medium", textAlign: "right" },
  status: {
    direction: "ltr", flexDirection: "row-reverse", alignItems: "center", justifyContent: "center",
    marginHorizontal: 16, marginTop: 10, minHeight: 52,
  },
  statusText: { color: C.textSecondary, fontSize: 13, fontFamily: "Cairo_500Medium", marginRight: 8 },
  errorText: { flex: 1, color: C.textSecondary, fontSize: 12, fontFamily: "Cairo_500Medium", textAlign: "right" },
  retry: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, marginHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  retryText: { color: C.text, fontSize: 12, fontFamily: "Cairo_700Bold" },
  done: { marginTop: 10, paddingBottom: 6 },
  head: {
    direction: "ltr", flexDirection: "row-reverse", alignItems: "center",
    marginHorizontal: 16, marginBottom: 8,
  },
  close: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  rail: { paddingHorizontal: 16 },
  cardCol: { width: CARD_W, marginLeft: 12 },
  meta: { color: C.textMuted, fontSize: 10, fontFamily: "Cairo_500Medium", textAlign: "right", marginTop: 4 },
  reason: { color: C.textSecondary, fontSize: 11, lineHeight: 17, fontFamily: "Cairo_500Medium", textAlign: "right", marginTop: 2 },
});
