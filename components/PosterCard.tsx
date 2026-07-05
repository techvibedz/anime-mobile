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
import { C, R, ELEVATION_CARD, TAr } from "../lib/theme";
import { posterUrl } from "../lib/img";
import { t } from "../lib/i18n";

export interface PosterCardProps {
  image?: string | null;
  title: string;
  onPress: () => void;
  onLongPress?: () => void;
  width: number;
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
  /** Title line clamp. Defaults to 2. */
  titleLines?: number;
  /** Optional muted subtitle below the title (type / format). */
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
  const sized = posterUrl(image, width);
  const uri = failedUri === sized ? image ?? undefined : sized;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      style={({ pressed }) => [
        { width },
        pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
      ]}
    >
      <View style={[s.plate, { width, aspectRatio }]}>
        {uri ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={recyclingKey}
            transition={200}
            onError={() => { if (sized && sized !== image) setFailedUri(sized); }}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, s.fallback]}>
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
        {topLeft && !newBadge ? <View style={s.topLeft}>{topLeft}</View> : null}
        {topRight ? <View style={s.topRight}>{topRight}</View> : null}
        {bottomLeft ? <View style={s.bottomLeft}>{bottomLeft}</View> : null}
        {bottomRight ? <View style={s.bottomRight}>{bottomRight}</View> : null}
        {centerOverlay ? <View style={s.center}>{centerOverlay}</View> : null}
        {footer}

        {loading && (
          <View style={s.loadingOverlay} pointerEvents="none">
            <ActivityIndicator color="#fff" />
          </View>
        )}
      </View>
      <Text style={[s.title, { width }]} numberOfLines={titleLines}>{title}</Text>
      {subtitle ? <Text style={[s.subtitle, { width }]} numberOfLines={1}>{subtitle}</Text> : null}
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
      <Ionicons name="play" size={14} color="#fff" />
    </View>
  );
}

const s = StyleSheet.create({
  plate: {
    borderRadius: R.lg,
    overflow: "hidden",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    ...ELEVATION_CARD,
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
    bottom: -8, left: -4,
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
    fontFamily: "Outfit_700Bold",
  },

  // Slot anchors
  topLeft: { position: "absolute", top: 8, left: 8, zIndex: 3 },
  topRight: { position: "absolute", top: 8, right: 8, zIndex: 3 },
  bottomLeft: { position: "absolute", bottom: 8, left: 8, zIndex: 3 },
  bottomRight: { position: "absolute", bottom: 8, right: 8, zIndex: 3 },
  center: {
    ...StyleSheet.absoluteFillObject,
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
    width: 28, height: 28, borderRadius: R.circle,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center", justifyContent: "center",
  },
  playHint: {
    width: 36, height: 36, borderRadius: R.circle,
    backgroundColor: C.ember,
    alignItems: "center", justifyContent: "center",
  },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(10,10,11,0.55)",
  },

  // Title — Arabic, right-aligned, Cairo.
  title: {
    ...TAr.bodySmall,
    color: C.text,
    marginTop: 8,
    textAlign: "right",
  },
  subtitle: {
    ...TAr.caption,
    color: C.textMuted,
    marginTop: 2,
    textAlign: "right",
  },
});
