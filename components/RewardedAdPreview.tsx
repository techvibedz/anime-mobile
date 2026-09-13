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

import { AR, C, S } from "../lib/theme";
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
            <LinearGradient
              colors={["#D85BFF", "#64118E", "#B52BE6", "#481060"]}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={s.frameBorder}
            >
              <View style={s.frame}>
                <LinearGradient
                  colors={["#16091F", "#050508", "#09060E"]}
                  end={{ x: 1, y: 1 }}
                  start={{ x: 0, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <Image resizeMode="stretch" source={background} style={s.backgroundArtwork} />
                </View>
                <LinearGradient
                  pointerEvents="none"
                  colors={["rgba(150,35,200,0.36)", "rgba(22,7,31,0)"]}
                  end={{ x: 0.5, y: 1 }}
                  start={{ x: 0.5, y: 0 }}
                  style={s.headerGlow}
                />

                <View pointerEvents="none" style={s.innerFrame} />
                <View pointerEvents="none" style={[s.edgeLine, s.edgeTop]} />
                <View pointerEvents="none" style={[s.edgeLine, s.edgeBottom]} />
                <View pointerEvents="none" style={[s.cornerCut, s.cornerTopLeft]} />
                <View pointerEvents="none" style={[s.cornerCut, s.cornerBottomRight]} />

                <LinearGradient
                  colors={["rgba(232,91,255,0.72)", "rgba(58,12,80,0.42)", "rgba(175,43,220,0.64)"]}
                  end={{ x: 1, y: 0.5 }}
                  start={{ x: 0, y: 0.5 }}
                  style={s.titleBorder}
                >
                  <LinearGradient
                    colors={["rgba(110,25,142,0.46)", "rgba(18,4,25,0.38)", "rgba(91,18,117,0.42)"]}
                    end={{ x: 1, y: 1 }}
                    start={{ x: 0, y: 0 }}
                    style={s.titleSurface}
                  >
                    <View pointerEvents="none" style={s.titleShine} />
                    <Text maxFontSizeMultiplier={1.1} numberOfLines={1} style={s.titleText}>
                      إعلان مطلوب
                    </Text>
                  </LinearGradient>
                </LinearGradient>

                <LinearGradient
                  colors={["rgba(229,100,255,0.72)", "rgba(115,19,166,0.5)", "rgba(57,16,79,0.36)"]}
                  end={{ x: 1, y: 1 }}
                  start={{ x: 0, y: 0 }}
                  style={s.mediaBorder}
                >
                  <LinearGradient
                    colors={["rgba(124,32,170,0.38)", "rgba(20,5,31,0.54)"]}
                    style={s.mediaSurface}
                  >
                    <Ionicons name="tv-outline" size={27} color="#FFFFFF" />
                    <View pointerEvents="none" style={s.playBadge}>
                      <Ionicons name="play" size={10} color="#FFFFFF" style={s.playIcon} />
                    </View>
                  </LinearGradient>
                </LinearGradient>

                <View pointerEvents="none" style={s.copyScrim} />
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

                <View style={s.duration}>
                  <Ionicons name="sparkles" size={12} color="#E967FA" style={s.durationIcon} />
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
                    colors={["rgba(244,111,255,0.78)", "rgba(142,31,195,0.58)", "rgba(91,14,128,0.46)"]}
                    end={{ x: 1, y: 1 }}
                    start={{ x: 0, y: 0 }}
                    style={s.watchBorder}
                  >
                    <LinearGradient
                      colors={["rgba(163,47,208,0.42)", "rgba(105,17,148,0.48)", "rgba(141,32,184,0.38)"]}
                      end={{ x: 1, y: 1 }}
                      start={{ x: 0, y: 0 }}
                      style={s.watchSurface}
                    >
                      <View pointerEvents="none" style={s.watchShine} />
                      <Ionicons
                        name="film-outline"
                        size={22}
                        color="#FFFFFF"
                        style={s.watchIcon}
                      />
                      <Text maxFontSizeMultiplier={1.1} numberOfLines={1} style={s.watchText}>
                        شاهد الإعلان
                      </Text>
                    </LinearGradient>
                  </LinearGradient>
                </Pressable>
              </View>
            </LinearGradient>

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
              <LinearGradient
                colors={["rgba(248,140,255,0.72)", "rgba(141,29,186,0.5)", "rgba(58,11,80,0.38)"]}
                end={{ x: 1, y: 1 }}
                start={{ x: 0, y: 0 }}
                style={s.closeBorder}
              >
                <View style={s.closeSurface}>
                  <Ionicons name="close" size={28} color="#FFFFFF" />
                </View>
              </LinearGradient>
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
  },
  frameBorder: {
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    padding: 2,
    borderRadius: 18,
    shadowColor: "#AF32DA",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.38,
    shadowRadius: 22,
    elevation: 20,
  },
  frame: {
    flex: 1,
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: C.bgDeep,
  },
  backgroundArtwork: {
    width: "100%",
    height: "100%",
  },
  headerGlow: {
    position: "absolute",
    left: 72,
    top: -70,
    width: 250,
    height: 175,
    borderRadius: 100,
  },
  innerFrame: {
    ...StyleSheet.absoluteFillObject,
    margin: 5,
    borderWidth: 1,
    borderColor: "rgba(202,81,240,0.4)",
    borderRadius: 11,
  },
  edgeLine: {
    position: "absolute",
    height: 2,
    backgroundColor: "rgba(218,87,255,0.76)",
  },
  edgeTop: { left: 44, right: 76, top: 5 },
  edgeBottom: { left: 98, right: 42, bottom: 5 },
  cornerCut: {
    position: "absolute",
    width: 54,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#DB55FF",
  },
  cornerTopLeft: { left: -15, top: 15, transform: [{ rotate: "-30deg" }] },
  cornerBottomRight: { right: -15, bottom: 15, transform: [{ rotate: "-30deg" }] },
  titleBorder: {
    position: "absolute",
    left: 100,
    top: 22,
    width: 190,
    height: 44,
    padding: 1,
    borderRadius: 8,
    transform: [{ skewX: "-4deg" }],
  },
  titleSurface: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
  },
  titleShine: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 4,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.38)",
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
    transform: [{ skewX: "4deg" }],
  },
  mediaBorder: {
    position: "absolute",
    left: 174,
    top: 80,
    width: 40,
    height: 35,
    padding: 1,
    borderRadius: 13,
  },
  mediaSurface: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  playBadge: {
    position: "absolute",
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "rgba(9,4,14,0.9)",
  },
  playIcon: { marginLeft: 1 },
  copyScrim: {
    position: "absolute",
    left: 78,
    top: 116,
    width: 232,
    height: 86,
    borderRadius: 42,
    backgroundColor: "rgba(3,3,7,0.24)",
  },
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
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(201,69,230,0.74)",
    borderRadius: 7,
    backgroundColor: "rgba(18,5,27,0.58)",
  },
  durationIcon: {
    position: "absolute",
    left: 7,
    top: 5,
  },
  durationText: {
    paddingHorizontal: 18,
    color: "#EB6AFA",
    fontSize: 9.5,
    lineHeight: 15,
    fontFamily: AR.semibold,
    textAlign: "center",
    writingDirection: "rtl",
  },
  watchTarget: {
    position: "absolute",
    left: 107,
    top: 190,
    width: 170,
    height: 33,
    overflow: "hidden",
    borderRadius: 10,
  },
  watchBorder: {
    flex: 1,
    padding: 1,
    borderRadius: 10,
  },
  watchSurface: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
  },
  watchShine: {
    position: "absolute",
    left: 13,
    right: 13,
    top: 4,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.44)",
  },
  watchIcon: {
    position: "absolute",
    left: 13,
    top: 5,
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
    borderRadius: 22,
  },
  closeBorder: {
    flex: 1,
    padding: 2,
    borderRadius: 22,
  },
  closeSurface: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "rgba(9,6,13,0.58)",
  },
  pressed: {
    opacity: 0.76,
    transform: [{ scale: 0.96 }],
  },
});
