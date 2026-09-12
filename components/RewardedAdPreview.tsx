// HERO: the supplied cyberpunk anime panel remains the notification itself.
import { useEffect, useRef } from "react";
import { Animated, Image, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReducedMotion } from "../lib/motion";

type Props = {
  visible: boolean;
  onClose: () => void;
  onWatchAd: () => void;
};

export function RewardedAdPreview({ visible, onClose, onWatchAd }: Props) {
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const scale = useRef(new Animated.Value(0.94)).current;
  const artworkWidth = Math.max(0, Math.min(190, screenWidth - 96, (screenHeight - 192) * 1.5));
  const artworkHeight = artworkWidth / 1.5;

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
        style={[s.artwork, { width: artworkWidth, height: artworkHeight, transform: [{ scale }] }]}
      >
        <Image
          source={require("../assets/rewarded-ad-preview.png")}
          resizeMode="contain"
          style={s.image}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إغلاق"
          hitSlop={12}
          onPress={onClose}
          style={({ pressed }) => [s.closeTarget, pressed && s.pressed]}
        />
        <Pressable
          testID="rewarded-ad-watch"
          accessibilityRole="button"
          accessibilityLabel="شاهد الإعلان"
          accessibilityHint="يشغّل اختبار زر الإعلان"
          hitSlop={12}
          onPress={onWatchAd}
          style={({ pressed }) => [s.watchTarget, pressed && s.pressed]}
        />
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
  artwork: {
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  closeTarget: {
    position: "absolute",
    right: "5%",
    top: "9%",
    width: "12%",
    height: "18%",
    borderRadius: 999,
  },
  watchTarget: {
    position: "absolute",
    left: "29%",
    bottom: "13%",
    width: "42%",
    height: "18%",
    borderRadius: 12,
  },
  pressed: { backgroundColor: "rgba(255,255,255,0.16)" },
});
