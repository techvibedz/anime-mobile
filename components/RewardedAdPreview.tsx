import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import { Animated, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AR, S } from "../lib/theme";
import { useReducedMotion } from "../lib/motion";

type Props = {
  visible: boolean;
  onClose: () => void;
  onWatchAd: () => void;
};

const DESIGN_WIDTH = 384;
const DESIGN_HEIGHT = 256;
const decorations = require("../assets/rewarded-ad-decorations.png");

export function RewardedAdPreview({ visible, onClose, onWatchAd }: Props) {
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const scale = useRef(new Animated.Value(0.96)).current;
  const cardWidth = Math.max(
    0,
    Math.min(460, width - 16, (height - insets.top - insets.bottom - 24) * 1.5),
  );
  const cardHeight = cardWidth / 1.5;
  const artScale = cardWidth / DESIGN_WIDTH;

  useEffect(() => {
    if (!visible) return;
    scale.setValue(reducedMotion ? 1 : 0.96);
    if (reducedMotion) return;
    Animated.spring(scale, {
      toValue: 1,
      damping: 18,
      stiffness: 220,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [reducedMotion, scale, visible]);

  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={[s.host, { top: insets.top + S.sm }]}>
      <Animated.View
        testID="rewarded-ad-preview"
        style={[s.shell, { width: cardWidth, height: cardHeight, transform: [{ scale }] }]}
      >
        <View style={s.clippedCard}>
          <View
            style={[
              s.artboard,
              {
                left: (cardWidth - DESIGN_WIDTH) / 2,
                top: (cardHeight - DESIGN_HEIGHT) / 2,
                transform: [{ scale: artScale }],
              },
            ]}
          >
            <LinearGradient colors={["#160A20", "#050509", "#0D0712"]} style={StyleSheet.absoluteFill} />
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(124,25,177,0.5)", "rgba(19,5,28,0)"]}
              style={s.headerGlow}
            />

            <View pointerEvents="none" style={s.innerFrame} />
            <View pointerEvents="none" style={[s.cornerStroke, s.cornerTopLeft]} />
            <View pointerEvents="none" style={[s.cornerStroke, s.cornerBottomRight]} />
            <View pointerEvents="none" style={s.topRail} />
            <View pointerEvents="none" style={s.bottomRail} />
            <View pointerEvents="none" style={s.leftRail} />
            <View pointerEvents="none" style={s.rightRail} />

            <LinearGradient colors={["#6F1B96", "#2B0A43", "#621484"]} style={s.titlePlate}>
              <View pointerEvents="none" style={s.titlePlateHighlight} />
            </LinearGradient>

            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Image source={decorations} resizeMode="stretch" style={StyleSheet.absoluteFill} />
            </View>

            <Text maxFontSizeMultiplier={1.1} numberOfLines={1} style={s.titleText}>
              إعلان مطلوب
            </Text>

            <Pressable
              testID="rewarded-ad-close"
              accessibilityRole="button"
              accessibilityLabel="إغلاق"
              hitSlop={4}
              onPress={onClose}
              android_ripple={{ color: "rgba(255,255,255,0.14)", borderless: true }}
              style={({ pressed }) => [s.closeButton, pressed && s.pressed]}
            >
              <View pointerEvents="none" style={s.closeInner}>
                <Ionicons name="close" size={27} color="#FFFFFF" />
              </View>
            </Pressable>

            <LinearGradient colors={["#8F27CC", "#3A0D5E"]} style={s.mediaIcon}>
              <Ionicons name="tv-outline" size={27} color="#FFFFFF" />
              <View pointerEvents="none" style={s.playDot}>
                <Ionicons name="play" size={9} color="#FFFFFF" style={s.playIcon} />
              </View>
            </LinearGradient>

            <Text maxFontSizeMultiplier={1.1} numberOfLines={1} style={s.headline}>
              شاهد <Text style={s.headlineAccent}>إعلاناً</Text>
            </Text>

            <Text
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.1}
              minimumFontScale={0.86}
              numberOfLines={1}
              style={s.subtitle}
            >
              لمواصلة مشاهدة الأنمي والمحتوى المميز
            </Text>

            <View style={s.duration}>
              <Ionicons name="sparkles" size={11} color="#E564F7" />
              <Text
                adjustsFontSizeToFit
                maxFontSizeMultiplier={1.1}
                minimumFontScale={0.84}
                numberOfLines={1}
                style={s.durationText}
              >
                لن يستغرق الأمر سوى 15 - 30 ثانية
              </Text>
            </View>

            <Pressable
              testID="rewarded-ad-watch"
              accessibilityRole="button"
              accessibilityLabel="شاهد الإعلان"
              accessibilityHint="يشغّل اختبار زر الإعلان"
              hitSlop={2}
              onPress={onWatchAd}
              android_ripple={{ color: "rgba(255,255,255,0.16)" }}
              style={({ pressed }) => [s.watchTarget, pressed && s.pressed]}
            >
              <LinearGradient colors={["#9B2BD5", "#541078", "#801DAA"]} style={s.watchButton}>
                <Ionicons name="film-outline" size={22} color="#FFFFFF" />
                <Text maxFontSizeMultiplier={1.1} numberOfLines={1} style={s.watchText}>
                  شاهد الإعلان
                </Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  host: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 100,
    alignItems: "center",
  },
  shell: {
    shadowColor: "#A82CDD",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.38,
    shadowRadius: 18,
    elevation: 18,
  },
  clippedCard: {
    flex: 1,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#A635D2",
    borderRadius: 12,
    backgroundColor: "#050509",
  },
  artboard: {
    position: "absolute",
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    direction: "ltr",
  },
  headerGlow: {
    position: "absolute",
    left: 78,
    top: -70,
    width: 235,
    height: 165,
    borderRadius: 100,
  },
  innerFrame: {
    ...StyleSheet.absoluteFillObject,
    margin: 5,
    borderWidth: 1,
    borderColor: "rgba(189,63,231,0.55)",
    borderRadius: 8,
  },
  cornerStroke: {
    position: "absolute",
    width: 56,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D74CFF",
  },
  cornerTopLeft: { left: -14, top: 14, transform: [{ rotate: "-29deg" }] },
  cornerBottomRight: { right: -14, bottom: 14, transform: [{ rotate: "-29deg" }] },
  topRail: {
    position: "absolute",
    top: 5,
    left: 48,
    width: 236,
    height: 2,
    backgroundColor: "rgba(204,71,246,0.62)",
  },
  bottomRail: {
    position: "absolute",
    left: 116,
    bottom: 5,
    width: 218,
    height: 2,
    backgroundColor: "rgba(204,71,246,0.62)",
  },
  leftRail: {
    position: "absolute",
    left: 5,
    top: 78,
    width: 2,
    height: 112,
    backgroundColor: "rgba(174,50,216,0.4)",
  },
  rightRail: {
    position: "absolute",
    right: 5,
    top: 66,
    width: 2,
    height: 112,
    backgroundColor: "rgba(174,50,216,0.4)",
  },
  titlePlate: {
    position: "absolute",
    left: 102,
    top: 20,
    width: 194,
    height: 47,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#C553EA",
    borderRadius: 5,
    transform: [{ skewX: "-4deg" }],
  },
  titlePlateHighlight: {
    position: "absolute",
    left: 8,
    right: 8,
    top: 4,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  titleText: {
    position: "absolute",
    left: 102,
    top: 25,
    zIndex: 4,
    width: 194,
    color: "#FFFFFF",
    fontSize: 22,
    lineHeight: 34,
    fontFamily: AR.bold,
    textAlign: "center",
    writingDirection: "rtl",
    textShadowColor: "#1B021F",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  closeButton: {
    position: "absolute",
    left: 333,
    top: 14,
    zIndex: 8,
    width: S.touchTarget,
    height: S.touchTarget,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#CB54EF",
    borderRadius: 22,
    backgroundColor: "#08060D",
  },
  closeInner: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(120,31,157,0.85)",
    borderRadius: 17,
    backgroundColor: "#17101D",
  },
  mediaIcon: {
    position: "absolute",
    left: 169,
    top: 74,
    zIndex: 4,
    width: 48,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#D766F5",
    borderRadius: 11,
  },
  playDot: {
    position: "absolute",
    width: 19,
    height: 19,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "rgba(12,5,18,0.92)",
  },
  playIcon: { marginLeft: 1 },
  headline: {
    position: "absolute",
    left: 105,
    top: 115,
    zIndex: 4,
    width: 176,
    color: "#FFFFFF",
    fontSize: 22,
    lineHeight: 33,
    fontFamily: AR.bold,
    textAlign: "center",
    writingDirection: "rtl",
  },
  headlineAccent: { color: "#DF4CF5" },
  subtitle: {
    position: "absolute",
    left: 91,
    top: 148,
    zIndex: 4,
    width: 204,
    color: "#F0EAF2",
    fontSize: 10.5,
    lineHeight: 18,
    fontFamily: AR.medium,
    textAlign: "center",
    writingDirection: "rtl",
  },
  duration: {
    position: "absolute",
    left: 104,
    top: 169,
    zIndex: 4,
    width: 178,
    height: 28,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 5,
    borderWidth: 1,
    borderColor: "#A333C8",
    borderRadius: 4,
    backgroundColor: "rgba(29,8,37,0.94)",
  },
  durationText: {
    flexShrink: 1,
    color: "#E15AF3",
    fontSize: 10,
    lineHeight: 17,
    fontFamily: AR.semibold,
    textAlign: "center",
    writingDirection: "rtl",
  },
  watchTarget: {
    position: "absolute",
    left: 112,
    top: 202,
    zIndex: 5,
    width: 162,
    height: S.touchTarget,
    overflow: "hidden",
    borderRadius: 7,
  },
  watchButton: {
    flex: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 8,
    borderWidth: 1,
    borderColor: "#E06BFA",
    borderRadius: 7,
  },
  watchText: {
    color: "#FFFFFF",
    fontSize: 17,
    lineHeight: 29,
    fontFamily: AR.bold,
    writingDirection: "rtl",
    textShadowColor: "rgba(24,0,35,0.82)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  pressed: { opacity: 0.76, transform: [{ scale: 0.96 }] },
});
