import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { M, MT, MANGA_FILL } from "../lib/manga/design";
import { CARD_LAYOUTS, type CardLayout } from "../lib/cardLayout";
import { t } from "../lib/i18n";
import { useReducedMotion } from "../lib/motion";
import { Shimmer } from "./Shimmer";

export function MangaSkeleton({ style, borderRadius = 4, dark = false }: { style?: ViewStyle; borderRadius?: number; dark?: boolean }) {
  return <Shimmer borderRadius={borderRadius} style={{ ...style, backgroundColor: dark ? M.nightLine : M.line }} />;
}

export function MangaLayoutControl({ layout, onChange }: { layout: CardLayout; onChange: (value: CardLayout) => void }) {
  const icons = { compact: "apps-outline", comfortable: "grid-outline", list: "list-outline" } as const;
  const labels = { compact: t.cardLayoutCompact, comfortable: t.cardLayoutComfortable, list: t.cardLayoutList };
  return <View style={s.layouts}>
    {CARD_LAYOUTS.map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={labels[value]}
      accessibilityState={{ selected: layout === value }} onPress={() => onChange(value)}
      style={({ pressed }) => [s.layout, value === layout && s.layoutActive, pressed && s.pressed]}>
      <Ionicons name={icons[value]} size={18} color={value === layout ? M.white : M.muted} />
    </Pressable>)}
  </View>;
}

/** A real cover with a visible fallback, never a wallpaper crop. */
export function MangaCover({ uri, style, label }: { uri?: string | null; style?: ViewStyle; label: string }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  return <View style={[s.cover, style]}>
    {uri && failedUri !== uri ? <Image source={{ uri }} style={MANGA_FILL} contentFit="cover" cachePolicy="memory-disk"
      recyclingKey={uri} transition={reducedMotion ? 0 : 120} accessibilityLabel={label} onError={() => setFailedUri(uri)} />
      : <View style={s.coverFallback}><Ionicons name="book-outline" size={28} color={M.muted} /><Text style={s.coverFallbackText} numberOfLines={3}>{label}</Text></View>}
  </View>;
}

export function MangaCardTile({ image, title, width, layout = "comfortable", subtitle, rank, topRight, onPress }: {
  image?: string | null; title: string; width: number; layout?: CardLayout; subtitle?: string;
  rank?: number; topRight?: ReactNode; onPress: () => void;
}) {
  const list = layout === "list";
  return <View style={{ width }}>
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={[title, subtitle].filter(Boolean).join("، ")}
      style={({ pressed }) => [list ? s.listCard : s.card, pressed && s.pressed]}>
      <View style={list ? s.listCoverWrap : undefined}>
        <MangaCover uri={image} label={title} style={list ? s.listCover : s.cardCover} />
        {rank != null && <View style={s.rank}><Text style={s.rankText}>{String(rank).padStart(2, "0")}</Text></View>}
      </View>
      <View style={list ? s.listInfo : s.cardInfo}>
        <Text style={[s.cardTitle, list && s.listTitle]} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={s.cardMeta} numberOfLines={list ? 2 : 1}>{subtitle}</Text> : null}
        {list && <View style={s.listAction}><Ionicons name="arrow-back" size={16} color={M.accent} /><Text style={s.listActionText}>عرض العمل</Text></View>}
      </View>
    </Pressable>
    {topRight && <View style={[s.corner, list && s.listCorner]}>{topRight}</View>}
  </View>;
}

export function MangaState({ icon, variant = "empty", title, message, primary, dark = false }: {
  icon: keyof typeof Ionicons.glyphMap; variant?: "empty" | "error" | "loading" | "offline";
  title: string; message?: string; primary?: { label: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }; dark?: boolean;
}) {
  return <View style={s.state}>
    <View style={[s.stateIcon, dark && { borderColor: M.nightLine, backgroundColor: M.nightPanel }]}>
      {variant === "loading" ? <ActivityIndicator color={dark ? M.nightAccent : M.accent} /> : <Ionicons name={icon} size={30} color={dark ? M.nightAccent : M.accent} />}
    </View>
    <Text style={[s.stateTitle, dark && { color: M.white }]}>{title}</Text>
    {message && <Text style={[s.stateMessage, dark && { color: M.nightMuted }]}>{message}</Text>}
    {primary && <Pressable onPress={primary.onPress} accessibilityRole="button" style={({ pressed }) => [s.stateButton, pressed && s.pressed]}>
      {primary.icon && <Ionicons name={primary.icon} size={18} color={M.white} />}
      <Text style={s.stateButtonText}>{primary.label}</Text>
    </Pressable>}
  </View>;
}

const s = StyleSheet.create({
  pressed: { opacity: 0.72 },
  layouts: { flexDirection: "row", borderWidth: 1, borderColor: M.line, borderRadius: 6, padding: 3, gap: 2, backgroundColor: M.sheet },
  layout: { width: 44, minHeight: 44, justifyContent: "center", alignItems: "center", borderRadius: 3 },
  layoutActive: { backgroundColor: M.ink },
  cover: { backgroundColor: M.wash, borderRadius: 4, overflow: "hidden" },
  coverFallback: { flex: 1, alignItems: "center", justifyContent: "center", padding: 10, gap: 8 },
  coverFallbackText: { ...MT.caption, color: M.muted, textAlign: "center" },
  card: { width: "100%" },
  cardCover: { width: "100%", aspectRatio: 2 / 3, borderWidth: 1, borderColor: M.line },
  cardInfo: { paddingTop: 8, gap: 3 },
  cardTitle: { ...MT.label, color: M.ink, textAlign: "right" },
  cardMeta: { ...MT.caption, color: M.muted, textAlign: "right" },
  rank: { position: "absolute", left: 0, bottom: 0, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: M.ink, borderTopRightRadius: 4 },
  rankText: { ...MT.number, color: M.white },
  corner: { position: "absolute", top: 4, right: 4 },
  listCorner: { right: 8, top: 8 },
  listCard: { flexDirection: "row-reverse", alignItems: "center", gap: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: M.line },
  listCoverWrap: { width: 88 },
  listCover: { width: 88, aspectRatio: 2 / 3 },
  listInfo: { flex: 1, minWidth: 0, alignItems: "flex-end" },
  listTitle: { ...MT.heading, fontSize: 17, lineHeight: 27 },
  listAction: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  listActionText: { ...MT.caption, color: M.accent },
  state: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, paddingVertical: 40, gap: 14 },
  stateIcon: { width: 76, height: 76, borderWidth: 1, borderColor: M.line, backgroundColor: M.sheet, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  stateTitle: { ...MT.heading, color: M.ink, textAlign: "center" },
  stateMessage: { ...MT.body, color: M.muted, textAlign: "center", maxWidth: 320 },
  stateButton: { minHeight: 52, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 22, backgroundColor: M.accent, borderRadius: 4, marginTop: 6 },
  stateButtonText: { ...MT.label, color: M.white },
});
