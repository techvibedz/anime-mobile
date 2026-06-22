// Poster-card badge that marks an anime the user has finished or caught up on.
//
//   • finished  → green "مكتمل" pill (watched the real finale of a completed series)
//   • caught up → cyan "آخر حلقة" pill (watched the latest available episode of a
//                 still-airing show)
//
// It reads the shared completion lookup (lib/completion) so any card can drop it
// in with just the anime's source hrefs/titles — no prop threading. Renders
// nothing when the anime isn't tracked, so it's safe to mount on every card.

import { memo } from "react";
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C, R } from "../lib/theme";
import { t } from "../lib/i18n";
import { useAnimeCompletion } from "../lib/completion";

export const CompletionBadge = memo(function CompletionBadge({
  hrefs,
  titles,
  style,
}: {
  hrefs?: (string | null | undefined)[];
  titles?: (string | null | undefined)[];
  style?: StyleProp<ViewStyle>;
}) {
  const rec = useAnimeCompletion(hrefs, titles);
  if (!rec || (!rec.finished && !rec.caughtUp)) return null;
  const finished = rec.finished;
  return (
    <View style={[s.badge, finished ? s.finished : s.caughtUp, style]} pointerEvents="none">
      <Ionicons name={finished ? "checkmark-done" : "checkmark"} size={10} color="#fff" />
      <Text style={s.text} numberOfLines={1}>
        {finished ? t.completedBadge : t.caughtUpBadge}
      </Text>
    </View>
  );
});

const s = StyleSheet.create({
  badge: {
    position: "absolute", bottom: 8, right: 8, zIndex: 3,
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: R.pill,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.22)",
  },
  finished: { backgroundColor: C.success },
  caughtUp: { backgroundColor: C.cyan },
  text: {
    color: "#fff", fontSize: 9, fontWeight: "800",
    fontFamily: "Cairo_700Bold",
  },
});
