import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import {
  Animated,
  I18nManager,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReducedMotion } from "../lib/motion";

type Props = {
  visible: boolean;
  onClose: () => void;
  onWatchAd: () => void;
};

const decorations = require("../assets/rewarded-ad-decorations.png");

export function RewardedAdPreview({ visible, onClose, onWatchAd }: Props) {
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scale = useRef(new Animated.Value(0.94)).current;
  const cardWidth = Math.min(400, width - 20);
  const side = I18nManager.isRTL
    ? { end: "30%" as const, start: "14%" as const }
    : { start: "30%" as const, end: "14%" as const };

  useEffect(() => {
    if (!visible) return;
    scale.setValue(reducedMotion ? 1 : 0.94);
    if (reducedMotion) return;
    Animated.spring(scale, {
      toValue: 1,
      damping: 16,
      stiffness: 180,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [reducedMotion, scale, visible]);

  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={[s.host, { top: insets.top + 12 }]}>
      <Animated.View
        testID="rewarded-ad-preview"
        style={[s.card, { width: cardWidth, height: cardWidth * (2 / 3), transform: [{ scale }] }]}
      >
        <LinearGradient colors={["#17101F", "#050509", "#0C0711"]} style={StyleSheet.absoluteFill} />
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(147,31,212,0.42)", "rgba(62,8,92,0)"]}
          style={s.glow}
        />

        <View pointerEvents="none" style={s.innerFrame} />
        <View pointerEvents="none" style={[s.corner, s.cornerTopLeft]} />
        <View pointerEvents="none" style={[s.corner, s.cornerBottomRight]} />
        <View pointerEvents="none" style={[s.rail, s.railTop]} />
        <View pointerEvents="none" style={[s.rail, s.railBottom]} />

        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Image source={decorations} resizeMode="stretch" style={StyleSheet.absoluteFill} />
        </View>

        <LinearGradient colors={["#5A147D", "#260A3F", "#641A86"]} style={[s.label, side]}>
          <View pointerEvents="none" style={s.labelHighlight} />
          <Text numberOfLines={1} style={s.labelText}>إعلان مطلوب</Text>
        </LinearGradient>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إغلاق"
          hitSlop={10}
          onPress={onClose}
          style={({ pressed }) => [
            s.closeButton,
            I18nManager.isRTL ? s.closeRTL : s.closeLTR,
            pressed && s.pressed,
          ]}
        >
          <View pointerEvents="none" style={s.closeInner}>
            <Ionicons name="close" size={25} color="#FFFFFF" />
          </View>
        </Pressable>

        <View style={[s.content, side]}>
          <LinearGradient colors={["#8F28D1", "#37105D"]} style={s.iconWrap}>
            <Ionicons name="tv-outline" size={27} color="#FFFFFF" />
            <View style={s.playDot}>
              <Ionicons name="play" size={9} color="#FFFFFF" />
            </View>
          </LinearGradient>

          <Text numberOfLines={1} style={s.headline}>
            شاهد <Text style={s.headlineAccent}>إعلاناً</Text>
          </Text>
          <Text numberOfLines={1} adjustsFontSizeToFit style={s.subtitle}>
            لمواصلة مشاهدة الأنمي والمحتوى المميز
          </Text>

          <View style={s.durationPill}>
            <Ionicons name="sparkles" size={11} color="#E96BFF" />
            <Text numberOfLines={1} adjustsFontSizeToFit style={s.durationText}>
              لن يستغرق الأمر سوى 15 - 30 ثانية
            </Text>
          </View>

          <Pressable
            testID="rewarded-ad-watch"
            accessibilityRole="button"
            accessibilityLabel="شاهد الإعلان"
            accessibilityHint="يشغّل اختبار زر الإعلان"
            onPress={onWatchAd}
            style={({ pressed }) => [s.watchTarget, pressed && s.pressed]}
          >
            <LinearGradient colors={["#8F28C8", "#421064", "#7A1BA3"]} style={s.watchButton}>
              <Ionicons name="film-outline" size={21} color="#FFFFFF" />
              <Text numberOfLines={1} style={s.watchText}>شاهد الإعلان</Text>
            </LinearGradient>
          </Pressable>
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
  card: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#A934DB",
    borderRadius: 18,
    backgroundColor: "#050509",
    shadowColor: "#B62CFF",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.42,
    shadowRadius: 20,
  },
  glow: {
    position: "absolute",
    top: -90,
    left: "23%",
    width: "66%",
    height: 190,
    borderRadius: 100,
  },
  innerFrame: {
    ...StyleSheet.absoluteFillObject,
    margin: 5,
    borderWidth: 1,
    borderColor: "rgba(194,67,242,0.48)",
    borderRadius: 13,
  },
  corner: {
    position: "absolute",
    width: 58,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D449FF",
  },
  cornerTopLeft: { left: -14, top: 15, transform: [{ rotate: "-29deg" }] },
  cornerBottomRight: { right: -14, bottom: 15, transform: [{ rotate: "-29deg" }] },
  rail: {
    position: "absolute",
    height: 2,
    backgroundColor: "rgba(207,74,255,0.68)",
  },
  railTop: { top: 6, left: "12%", right: "26%" },
  railBottom: { bottom: 6, left: "28%", right: "12%" },
  label: {
    position: "absolute",
    top: 15,
    height: 47,
    zIndex: 3,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#C855F0",
    borderRadius: 5,
    transform: [{ skewX: "-4deg" }],
  },
  labelHighlight: {
    position: "absolute",
    left: 8,
    right: 8,
    top: 4,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.38)",
  },
  labelText: {
    color: "#FFFFFF",
    fontSize: 22,
    lineHeight: 32,
    fontFamily: "Cairo_700Bold",
    textShadowColor: "#1C031F",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
    transform: [{ skewX: "4deg" }],
    writingDirection: "rtl",
  },
  closeButton: {
    position: "absolute",
    top: 10,
    zIndex: 10,
    width: 43,
    height: 43,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#C64EF1",
    borderRadius: 22,
    backgroundColor: "#08060D",
  },
  closeRTL: { start: 7 },
  closeLTR: { end: 7 },
  closeInner: {
    width: 33,
    height: 33,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(121,29,164,0.8)",
    borderRadius: 17,
    backgroundColor: "#16101C",
  },
  content: {
    position: "absolute",
    top: 67,
    bottom: 10,
    zIndex: 4,
    alignItems: "center",
  },
  iconWrap: {
    width: 49,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#D96BFF",
    borderRadius: 12,
  },
  playDot: {
    position: "absolute",
    width: 19,
    height: 19,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "rgba(14,7,23,0.9)",
  },
  headline: {
    marginTop: 1,
    color: "#FFFFFF",
    fontSize: 22,
    lineHeight: 31,
    fontFamily: "Cairo_700Bold",
    textAlign: "center",
    writingDirection: "rtl",
  },
  headlineAccent: { color: "#D947F7" },
  subtitle: {
    width: "100%",
    marginTop: -4,
    color: "#EEE8F1",
    fontSize: 10.5,
    lineHeight: 17,
    fontFamily: "Cairo_500Medium",
    textAlign: "center",
    writingDirection: "rtl",
  },
  durationPill: {
    width: "100%",
    height: 27,
    marginTop: 2,
    paddingHorizontal: 8,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "#A432CD",
    borderRadius: 4,
    backgroundColor: "rgba(31,10,40,0.88)",
  },
  durationText: {
    flexShrink: 1,
    color: "#D850F4",
    fontSize: 10,
    lineHeight: 17,
    fontFamily: "Cairo_600SemiBold",
    textAlign: "center",
    writingDirection: "rtl",
  },
  watchTarget: {
    width: "88%",
    height: 43,
    marginTop: 5,
    borderRadius: 7,
  },
  watchButton: {
    flex: 1,
    paddingHorizontal: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#E067FF",
    borderRadius: 7,
  },
  watchText: {
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 29,
    fontFamily: "Cairo_700Bold",
    textShadowColor: "rgba(24,0,35,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
    writingDirection: "rtl",
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});
