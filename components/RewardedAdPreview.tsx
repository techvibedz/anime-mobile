// HERO: the supplied cyberpunk anime panel remains the notification itself.
import { useEffect, useRef } from "react";
import { Animated, Image, Modal, Pressable, StyleSheet, View } from "react-native";

import { useReducedMotion } from "../lib/motion";

type Props = {
  visible: boolean;
  onClose: () => void;
  onWatchAd: () => void;
};

export function RewardedAdPreview({ visible, onClose, onWatchAd }: Props) {
  const reducedMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(0.94)).current;

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

  return (
    <Modal
      transparent
      statusBarTranslucent
      visible={visible}
      animationType={reducedMotion ? "none" : "fade"}
      onRequestClose={onClose}
    >
      <View style={s.backdrop}>
        <Animated.View testID="rewarded-ad-preview" style={[s.artwork, { transform: [{ scale }] }]}>
          <Image
            source={require("../assets/rewarded-ad-preview.png")}
            resizeMode="contain"
            style={StyleSheet.absoluteFillObject}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إغلاق"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [s.closeTarget, pressed && s.pressed]}
          />
          <Pressable
            testID="rewarded-ad-watch"
            accessibilityRole="button"
            accessibilityLabel="شاهد الإعلان"
            accessibilityHint="يشغّل اختبار زر الإعلان"
            hitSlop={6}
            onPress={onWatchAd}
            style={({ pressed }) => [s.watchTarget, pressed && s.pressed]}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 24,
    backgroundColor: "rgba(3,2,8,0.82)",
  },
  artwork: {
    width: "100%",
    maxWidth: 400,
    aspectRatio: 1.5,
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
