// Unified poster card — the ONE anatomy for every anime/episode poster across
// the app. Replaces the 4+ competing card variants that previously diverged
// (home anime card, search result, related card, my-list card, catalog card).
//
// Slot-based so each call site composes its own overlay furniture without
// forking the card itself:
//   • topLeft / topRight   — badges, remove buttons, status pills
//   • bottomLeft / bottomRight — MAL rating, completion badge, type tag
//   • centerOverlay        — play hint, resolving spinner
//   • footer               — full-width ribbon (e.g. relation type)
//   • rank                 — editorial numeral (home trending)
//   • newBadge             — "جديد" pill
//
// All posters share: 2:3 artwork-first plate, R.lg crisp corner, hairline
// border, ambient lift (no per-card glow), bottom scrim so overlay text clears
// AA, RTL right-aligned Arabic title (Cairo). One vocabulary, one feel.

import { memo, useState, type ReactNode } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { C, R, TAr, ABSOLUTE_FILL } from "../lib/theme";
import { posterUrl } from "../lib/img";
import { t } from "../lib/i18n";
import type { CardLayout } from "../lib/cardLayout";

export const INLINE_POSTER_BADGE = { position: "relative" as const, top: 0, right: 0, bottom: 0, left: 0 };

/** Height of the overlaid title band at the bottom of a grid poster. */
export const GRID_TITLE_BAND = 48;

export interface PosterCardProps {
  image?: string | null;
  title: string;
  onPress: () => void;
  onLongPress?: () => void;
  width: number;
  layout?: CardLayout;
  /** Poster aspect ratio. Defaults to 2/3 (standard anime poster). */
  aspectRatio?: number;
  /** Editorial rank numeral overlaid bottom-left (home trending). */
  rank?: number;
  /** "جديد" pill, top-left. */
  newBadge?: boolean;
  /** Overlay furniture — each rendered absolutely if provided. */
  topLeft?: ReactNode;
  topRight?: ReactNode;
  bottomLeft?: ReactNode;
  bottomRight?: ReactNode;
  /** Centered overlay (play hint / resolving spinner). */
  centerOverlay?: ReactNode;
  /** Full-width bar across the poster bottom (relation ribbon). */
  footer?: ReactNode;
  /** Spinner overlay while a tap resolves. */
  loading?: boolean;
  /** Disable press (no source href yet). */
  disabled?: boolean;
  /** Title line clamp in list layout; grid titles always fit two poster lines. */
  titleLines?: number;
  /** Muted subtitle under the title — rendered in list layout only. */
  subtitle?: string;
  /** Recycling key for expo-image caching. */
  recyclingKey?: string;
}

export const PosterCard = memo(function PosterCard({
  image,
  title,
  onPress,
  onLongPress,
  width,
  layout = "comfortable",
  aspectRatio = 2 / 3,
  rank,
  newBadge,
  topLeft,
  topRight,
  bottomLeft,
  bottomRight,
  centerOverlay,
  footer,
  loading = false,
  disabled = false,
  titleLines = 2,
  subtitle,
  recyclingKey,
}: PosterCardProps) {
  // Serve witanime posters right-sized as WebP via Photon; fall back to the raw
  // URL if the sized fetch errors. failedUri self-resets on recycle because a
  // new `image` prop yields a new `sized` that won't match the stale value.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const row = layout === "list";
  const plateWidth = row ? 84 : width;
  const sized = posterUrl(image, plateWidth);
  const uri = failedUri === sized ? image ?? undefined : sized;
  // List layout keeps a readable inline caption; grid layouts carry the title
  // ON the poster, so a grid cell is exactly one artwork and no caption can
  // ever add space between rows.
  const caption = (
    <View style={s.listBody}>
      <Text style={s.title} numberOfLines={Math.min(titleLines, 2)} ellipsizeMode="tail">{title}</Text>
      {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      <View style={s.listMeta}>{topLeft}{topRight}{bottomLeft}{bottomRight}</View>
      {footer}
    </View>
  );
  const gridTitle = (
    <View style={s.titleBand} pointerEvents="none">
      <Text
        style={[s.gridTitle, layout === "compact" && s.gridTitleCompact]}
        numberOfLines={2}
        ellipsizeMode="tail"
        maxFontSizeMultiplier={1.2}
      >
        {title}
      </Text>
    </View>
  );
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={{ disabled, busy: loading }}
      style={({ pressed }) => [
        { width },
        row && s.listCard,
        pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
      ]}
    >
      {row ? caption : null}
      <View style={[s.plate, { width: plateWidth, aspectRatio }]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={ABSOLUTE_FILL}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={recyclingKey}
            transition={200}
            onError={() => { if (sized && sized !== image) setFailedUri(sized); }}
          />
        ) : (
          <View style={[ABSOLUTE_FILL, s.fallback]}>
            <Ionicons name="image-outline" size={26} color={C.textMuted} />
          </View>
        )}

        {/* Bottom scrim — guarantees overlay text clears WCAG AA over art. */}
        <LinearGradient
          colors={["transparent", "rgba(10,10,11,0.55)", "rgba(10,10,11,0.92)"]}
          locations={[0, 0.55, 1]}
          style={s.scrim}
        />

        {/* Rank numeral — editorial, oversized, sits behind badges. */}
        {rank != null && (
          <Text style={s.rank}>{rank}</Text>
        )}

        {/* NEW badge — top-left, reserved spot. */}
        {newBadge && (
          <View style={s.newBadge}>
            <Text style={s.newBadgeText}>{t.newBadge}</Text>
          </View>
        )}

        {/* Slot furniture */}
        {!row && topLeft && !newBadge ? <View style={s.topLeft}>{topLeft}</View> : null}
        {!row && topRight ? <View style={s.topRight}>{topRight}</View> : null}
        {!row && bottomLeft ? <View style={s.bottomLeft}>{bottomLeft}</View> : null}
        {!row && bottomRight ? <View style={s.bottomRight}>{bottomRight}</View> : null}
        {centerOverlay ? <View style={s.center}>{centerOverlay}</View> : null}
        {!row ? footer : null}
        {!row ? gridTitle : null}

        {loading && (
          <View style={s.loadingOverlay} pointerEvents="none">
            <ActivityIndicator color="#fff" />
          </View>
        )}
      </View>
    </Pressable>
  );
});

/* ── Slot helpers ──────────────────────────────
 * Reusable overlay pieces call sites compose into the slots, so the chrome
 * vocabulary stays consistent without each screen reinventing a pill. */

/** Compact dark pill for a corner — used by type tags, source tags, etc. */
export function PosterPill({
  children,
  tint,
  style,
}: {
  children: ReactNode;
  tint?: string;
  style?: any;
}) {
  return (
    <View style={[s.pill, tint ? { backgroundColor: tint } : null, style]}>
      {children}
    </View>
  );
}

/** Small circular control button pinned to a corner (remove / download). */
export function PosterCornerBtn({
  icon,
  onPress,
  tint = "#fff",
  size = 15,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  tint?: string;
  size?: number;
  style?: any;
}) {
  return (
    <Pressable
      onPress={(e) => { e.stopPropagation?.(); onPress(); }}
      hitSlop={8}
      style={[s.cornerBtn, style]}
    >
      <Ionicons name={icon} size={size} color={tint} />
    </Pressable>
  );
}

/** Centered play hint (continue-watching / my-list). */
export function PosterPlayHint() {
  return (
    <View style={s.playHint}>
      <Ionicons name="play" size={14} color={C.textOnAccent} />
    </View>
  );
}

const s = StyleSheet.create({
  plate: {
    borderRadius: R.lg,
    overflow: "hidden",
    backgroundColor: C.surface,
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surface,
  },
  scrim: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    height: "55%",
  },

  // Rank — oversized editorial numeral, bottom-left, behind furniture.
  rank: {
    position: "absolute",
    bottom: GRID_TITLE_BAND - 2, left: -4,
    fontSize: 48, fontWeight: "900", lineHeight: 48, letterSpacing: -1.5,
    color: "#ffffff",
    fontFamily: "Outfit_900Black",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    opacity: 0.95,
  },

  // NEW badge — top-left reserved spot (clears the rank).
  newBadge: {
    position: "absolute", top: 8, left: 8, zIndex: 4,
    backgroundColor: C.ember,
    borderRadius: R.xs, paddingHorizontal: 7, paddingVertical: 3,
  },
  newBadgeText: {
    color: C.textOnAccent, fontSize: 9, fontWeight: "700", letterSpacing: 0.8,
    fontFamily: "Cairo_700Bold",
  },

  // Slot anchors
  topLeft: { position: "absolute", top: 8, left: 8, zIndex: 3 },
  topRight: { position: "absolute", top: 8, right: 8, zIndex: 3 },
  bottomLeft: { position: "absolute", bottom: GRID_TITLE_BAND + 8, left: 8, zIndex: 3 },
  bottomRight: { position: "absolute", bottom: GRID_TITLE_BAND + 8, right: 8, zIndex: 3 },
  center: {
    ...ABSOLUTE_FILL,
    alignItems: "center", justifyContent: "center",
    zIndex: 2,
  },

  // Reusable pieces
  pill: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "rgba(0,0,0,0.7)", borderRadius: R.sm,
    paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  cornerBtn: {
    width: 36, height: 36, borderRadius: R.sm,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center", justifyContent: "center",
  },
  playHint: {
    width: 36, height: 36, borderRadius: R.circle,
    backgroundColor: C.ember,
    alignItems: "center", justifyContent: "center",
  },

  loadingOverlay: {
    ...ABSOLUTE_FILL,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(10,10,11,0.55)",
  },

  // Grid poster title — overlaid on the artwork above the scrim. The band is a
  // fixed height so bottom badges stay put and no title can grow the card.
  titleBand: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    height: GRID_TITLE_BAND, justifyContent: "flex-end",
    paddingHorizontal: 8, paddingBottom: 6,
  },
  gridTitle: {
    fontFamily: "Cairo_600SemiBold", fontWeight: "600" as const,
    fontSize: 12, lineHeight: 17, color: "#FFFFFF",
    textAlign: "right", includeFontPadding: false,
    textShadowColor: "rgba(0,0,0,0.65)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  gridTitleCompact: { fontSize: 11, lineHeight: 16 },

  // List layout caption.
  listCard: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: R.lg, backgroundColor: C.surfaceContainer },
  listBody: { flex: 1, marginRight: 14, minWidth: 0 },
  listMeta: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 12 },
  title: {
    ...TAr.bodySmall,
    fontSize: 16,
    lineHeight: 26,
    flexShrink: 1,
    includeFontPadding: false,
    color: C.text,
    textAlign: "right",
  },
  subtitle: {
    ...TAr.caption,
    color: C.textMuted,
    marginTop: 2,
    textAlign: "right",
  },
});
