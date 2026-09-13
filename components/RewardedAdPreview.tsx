import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import {
  Animated,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
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
const STAGE_HEIGHT = 318;

const background = require("../assets/rewarded-ad-background-v2.png");
const avatar = require("../assets/rewarded-ad-avatar.png");
const katana = require("../assets/rewarded-ad-katana.png");
const shuriken = require("../assets/rewarded-ad-shuriken.png");

export function RewardedAdPreview({ visible, onClose, onWatchAd }: Props) {
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const entrance = useRef(new Animated.Value(0)).current;
  const cardWidth = Math.max(
    0,
    Math.min(
      430,
      width - 40,
      (height - insets.top - insets.bottom - 48) * (DESIGN_WIDTH / STAGE_HEIGHT),
    ),
  );
  const cardHeight = cardWidth * (DESIGN_HEIGHT / DESIGN_WIDTH);
  const artScale = cardWidth / DESIGN_WIDTH;

  useEffect(() => {
    if (!visible) return;
    entrance.setValue(reducedMotion ? 1 : 0);
    if (reducedMotion) return;
    Animated.spring(entrance, {
      toValue: 1,
      damping: 20,
      stiffness: 210,
      mass: 0.72,
      useNativeDriver: true,
    }).start();
  }, [entrance, reducedMotion, visible]);

  return (
    <Modal
      animationType={reducedMotion ? "none" : "fade"}
      navigationBarTranslucent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        style={[s.modalRoot, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
      >
        <Pressable
          accessibilityLabel="إغلاق نافذة الإعلان"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(3,3,7,0.84)", "rgba(9,5,14,0.76)", "rgba(3,3,7,0.9)"]}
          style={StyleSheet.absoluteFill}
        />

        <Animated.View
          testID="rewarded-ad-preview"
          style={[
            s.stage,
            {
              width: cardWidth,
              height: cardHeight,
              opacity: entrance,
              transform: [
                {
                  translateY: entrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [12, 0],
                  }),
                },
                {
                  scale: entrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.96, 1],
                  }),
                },
              ],
            },
          ]}
        >
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
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Image resizeMode="stretch" source={background} style={s.backgroundArtwork} />
            </View>

            <View pointerEvents="none" style={s.titleSlot}>
              <Text maxFontSizeMultiplier={1.1} numberOfLines={1} style={s.titleText}>
                إعلان مطلوب
              </Text>
            </View>

            <View pointerEvents="none" style={s.mediaIcon}>
              <Ionicons name="tv-outline" size={25} color="#FFFFFF" />
            </View>

            <Text maxFontSizeMultiplier={1.1} numberOfLines={1} style={s.headline}>
              شاهد <Text style={s.headlineAccent}>إعلاناً</Text>
            </Text>
            <Text
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.1}
              minimumFontScale={0.9}
              numberOfLines={1}
              style={s.subtitle}
            >
              لمواصلة مشاهدة الأنمي والمحتوى المميز
            </Text>

            <View pointerEvents="none" style={s.duration}>
              <Ionicons name="sparkles" size={11} color="#E967FA" />
              <Text
                adjustsFontSizeToFit
                maxFontSizeMultiplier={1.1}
                minimumFontScale={0.86}
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
              onPress={onWatchAd}
              style={({ pressed }) => [s.watchTarget, pressed && s.pressed]}
            >
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(255,255,255,0.25)", "rgba(255,255,255,0)", "rgba(111,16,150,0.18)"]}
                end={{ x: 1, y: 1 }}
                start={{ x: 0, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
              <View pointerEvents="none" style={s.watchContent}>
                <View style={s.watchPlay}>
                  <Ionicons name="play" size={14} color="#FFFFFF" style={s.playIcon} />
                </View>
                <Text maxFontSizeMultiplier={1.1} numberOfLines={1} style={s.watchText}>
                  شاهد الإعلان
                </Text>
              </View>
            </Pressable>

            <View pointerEvents="none" style={s.artworkLayer}>
              <Image resizeMode="contain" source={avatar} style={s.avatar} />
              <Image resizeMode="contain" source={shuriken} style={s.shuriken} />
              <Image resizeMode="contain" source={katana} style={s.katana} />
            </View>

            <Pressable
              testID="rewarded-ad-close"
              accessibilityRole="button"
              accessibilityLabel="إغلاق"
              onPress={onClose}
              style={({ pressed }) => [s.closeTarget, pressed && s.pressed]}
            >
              <Ionicons name="close" size={27} color="#FFFFFF" style={s.closeIcon} />
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  modalRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stage: {
    overflow: "visible",
  },
  artboard: {
    position: "absolute",
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    direction: "ltr",
    overflow: "visible",
    shadowColor: "#AF32DA",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.38,
    shadowRadius: 22,
    elevation: 20,
  },
  backgroundArtwork: {
    width: "100%",
    height: "100%",
  },
  titleSlot: {
    position: "absolute",
    left: 100,
    top: 22,
    width: 190,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  titleText: {
    color: "#FFFFFF",
    fontSize: 21,
    lineHeight: 31,
    fontFamily: AR.bold,
    textAlign: "center",
    writingDirection: "rtl",
    textShadowColor: "#19021F",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  mediaIcon: {
    position: "absolute",
    left: 174,
    top: 80,
    width: 40,
    height: 35,
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: { marginLeft: 1 },
  headline: {
    position: "absolute",
    left: 103,
    top: 107,
    width: 182,
    color: "#FFFFFF",
    fontSize: 23,
    lineHeight: 34,
    fontFamily: AR.bold,
    textAlign: "center",
    writingDirection: "rtl",
  },
  headlineAccent: { color: "#E754F7" },
  subtitle: {
    position: "absolute",
    left: 86,
    top: 140,
    width: 216,
    color: "#F6F1F8",
    fontSize: 11,
    lineHeight: 18,
    fontFamily: AR.medium,
    textAlign: "center",
    writingDirection: "rtl",
  },
  duration: {
    position: "absolute",
    left: 111,
    top: 158,
    width: 162,
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  durationText: {
    color: "#EB6AFA",
    fontSize: 9,
    lineHeight: 15,
    fontFamily: AR.semibold,
    textAlign: "center",
    writingDirection: "rtl",
  },
  watchTarget: {
    position: "absolute",
    left: 100,
    top: 183,
    zIndex: 6,
    width: 184,
    height: 42,
    overflow: "hidden",
    borderRadius: 12,
  },
  watchContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  watchPlay: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
    borderRadius: 12,
    backgroundColor: "rgba(12,5,17,0.72)",
  },
  watchText: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 25,
    fontFamily: AR.bold,
    textAlign: "center",
    writingDirection: "rtl",
    textShadowColor: "rgba(26,0,34,0.86)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  artworkLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 7,
    overflow: "visible",
  },
  avatar: {
    position: "absolute",
    left: -21,
    top: -49,
    zIndex: 7,
    width: 157,
    height: 151,
  },
  shuriken: {
    position: "absolute",
    left: -12,
    bottom: -13,
    zIndex: 7,
    width: 86,
    height: 67,
  },
  katana: {
    position: "absolute",
    right: -15,
    bottom: -12,
    zIndex: 7,
    width: 78,
    height: 140,
  },
  closeTarget: {
    position: "absolute",
    right: 8,
    top: 14,
    zIndex: 12,
    width: S.touchTarget,
    height: S.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  closeIcon: {
    textShadowColor: "#08030D",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  pressed: {
    opacity: 0.76,
    transform: [{ scale: 0.96 }],
  },
});
