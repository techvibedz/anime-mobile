// Numbered chapter index, shared by details and the reader's chapter sheet.

import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { M, MT } from "../lib/manga/design";

export const CHAPTER_ROW_HEIGHT = 64;

export const ChapterRow = memo(function ChapterRow({
  number,
  title,
  date,
  read = false,
  active = false,
  onPress,
  onLongPress,
}: {
  number: string;
  title?: string | null;
  date?: string | null;
  read?: boolean;
  active?: boolean;
  onPress: () => void;
  /** Reader sheet: long-press toggles the read mark. */
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`الفصل ${number}${title ? `، ${title}` : ""}${read ? "، مقروء" : ""}`}
      accessibilityHint={onLongPress ? "اضغط مطولاً لتغيير علامة القراءة" : undefined}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [s.row, active && s.rowActive, pressed && s.pressed]}
    >
      <View style={[s.badge, active && s.badgeActive]}>
        <Text style={s.badgeLabel}>الفصل</Text>
        <Text style={[s.badgeText, read && s.badgeTextRead]} numberOfLines={1}>{number}</Text>
      </View>
      <View style={s.mid}>
        <Text style={s.title} numberOfLines={2}>{title || (active ? "أقرأ الآن" : read ? "تمت القراءة" : "جاهز للقراءة")}</Text>
        {date ? <Text style={s.date} numberOfLines={1}>{date}</Text> : null}
      </View>
      {read ? (
        <Ionicons name="checkmark-circle" size={18} color={M.read} />
      ) : (
        <Ionicons name="chevron-back" size={16} color={M.muted} />
      )}
    </Pressable>
  );
});

const s = StyleSheet.create({
  row: {
    flexDirection: "row-reverse",
    alignItems: "center",
    minHeight: CHAPTER_ROW_HEIGHT + 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: M.line,
    backgroundColor: M.sheet,
  },
  rowActive: { backgroundColor: M.accentWash, borderColor: M.accent },
  pressed: { opacity: 0.85 },
  badge: {
    width: 76,
    alignItems: "center",
    borderLeftWidth: 1,
    borderColor: M.line,
    paddingLeft: 8,
  },
  badgeActive: { borderColor: M.accent },
  badgeLabel: { ...MT.caption, fontSize: 10, lineHeight: 17, color: M.muted },
  badgeText: { ...MT.number, fontSize: 23, lineHeight: 30, color: M.ink },
  badgeTextRead: { color: M.read },
  mid: { flex: 1, alignItems: "flex-end", minWidth: 0, marginHorizontal: 12 },
  title: { ...MT.label, color: M.ink, textAlign: "right" },
  date: { ...MT.caption, fontSize: 12, color: M.muted, textAlign: "right", marginTop: 2 },
});
