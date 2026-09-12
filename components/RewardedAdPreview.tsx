// HERO: the supplied neon anime reward panel stays pixel-identical while its painted controls become tappable.
import { useEffect, useRef } from "react";
import { Animated, Image, Modal, Pressable, StyleSheet, View } from "react-native";

type Props = {
  visible: boolean;
  onClose: () => void;
  onWatchAd: () => void;
};

export function RewardedAdPreview({ visible, onClose, onWatchAd }: Props) {
  const scale = useRef(new Animated.Value(0.94)).current;

  useEffect(() => {
    if (!visible) return;
    scale.setValue(0.94);
    Animated.spring(scale, {
      toValue: 1,
      damping: 16,
      stiffness: 180,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [scale, visible]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Animated.View style={[s.artworkWrap, { transform: [{ scale }] }]}>
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
            accessibilityRole="button"
            accessibilityLabel="شاهد الإعلان"
            accessibilityHint="يشغّل اختبار زر الإعلان"
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
    paddingHorizontal: 8,
    backgroundColor: "rgba(0,0,0,0.9)",
  },
  artworkWrap: {
    width: "100%",
    maxWidth: 680,
    aspectRatio: 1.5,
  },
  closeTarget: {
    position: "absolute",
    right: "4%",
    top: "9%",
    width: "15%",
    height: "19%",
    borderRadius: 999,
  },
  watchTarget: {
    position: "absolute",
    left: "28%",
    bottom: "10%",
    width: "44%",
    height: "20%",
    borderRadius: 12,
  },
  pressed: { opacity: 0.72 },
});
