import { memo, useCallback, useRef } from "react";
import { Animated, AppState, Easing, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import { useSidebar } from "./Sidebar";
import { useReducedMotion } from "../lib/motion";
import { C, ABSOLUTE_FILL } from "../lib/theme";

const LETTERS = "Pantoufa".split("");

/** A short signature burst, followed by a three-second rest. */
export const PantoufaWordmark = memo(function PantoufaWordmark() {
  const reduced = useReducedMotion();
  const { open } = useSidebar();
  const sweep = useRef(new Animated.Value(0)).current;
  const letters = useRef(LETTERS.map(() => new Animated.Value(0))).current;

  useFocusEffect(useCallback(() => {
    if (reduced || open) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let burst: Animated.CompositeAnimation | undefined;
    const reset = () => {
      clearTimeout(timer);
      burst?.stop();
      sweep.setValue(0);
      letters.forEach(letter => letter.setValue(0));
    };
    const play = () => {
      if (!alive || AppState.currentState !== "active") return;
      sweep.setValue(0);
      burst = Animated.parallel([
        Animated.timing(sweep, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.cubic), useNativeDriver: true, isInteraction: false }),
        Animated.stagger(65, letters.map(letter => Animated.sequence([
          Animated.timing(letter, { toValue: 1, duration: 190, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false }),
          Animated.spring(letter, { toValue: 0, damping: 9, stiffness: 180, mass: 0.6, useNativeDriver: true, isInteraction: false }),
        ]))),
      ]);
      burst.start(({ finished }) => {
        if (alive && finished && AppState.currentState === "active") timer = setTimeout(play, 3000);
      });
    };
    if (AppState.currentState === "active") timer = setTimeout(play, 1800);
    const sub = AppState.addEventListener("change", state => {
      reset();
      if (state === "active") timer = setTimeout(play, 1800);
    });
    return () => { alive = false; reset(); sub.remove(); };
  }, [reduced, open, sweep, letters]));

  const flash = sweep.interpolate({ inputRange: [0, 0.18, 0.65, 1], outputRange: [0, 0.9, 0.5, 0] });
  return (
    <View style={st.root} accessible accessibilityRole="text" accessibilityLabel="Pantoufa">
      <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{
        transform: [
          { scale: sweep.interpolate({ inputRange: [0, 0.2, 0.55, 1], outputRange: [1, 1.055, 1.02, 1] }) },
          { rotate: sweep.interpolate({ inputRange: [0, 0.2, 0.55, 1], outputRange: ["0deg", "-2deg", "1deg", "0deg"] }) },
        ],
      }}>
        <View style={st.word}>
          {LETTERS.map((letter, i) => <Animated.Text key={i} maxFontSizeMultiplier={1.25} style={[st.letter, {
            transform: [
              { translateY: letters[i].interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) },
              { rotate: letters[i].interpolate({ inputRange: [0, 1], outputRange: ["0deg", i % 2 ? "7deg" : "-7deg"] }) },
            ],
          }]}>{letter}</Animated.Text>)}
        </View>
        <View style={st.sweepClip} pointerEvents="none">
          <Animated.View style={[st.sweep, { opacity: flash, transform: [
            { translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-40, 180] }) }, { rotate: "18deg" },
          ] }]}><LinearGradient colors={["transparent", C.mintGlow, "rgba(255,255,255,0.65)", "transparent"]} style={st.fill} /></Animated.View>
        </View>
        <Animated.View style={[st.underline, { opacity: flash, transform: [{ scaleX: sweep.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.2, 1, 0.2] }) }] }]} />
        {[0, 1].map(i => <Animated.View key={i} pointerEvents="none" style={[st.spark, {
          backgroundColor: i ? C.accent : C.mint, opacity: flash,
          transform: [
            { translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [95, i ? 140 : 65] }) },
            { translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [12, i ? 33 : -4] }) },
            { scale: sweep.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1.2, 0] }) },
            { rotate: "45deg" },
          ],
        }]} />)}
      </Animated.View>
    </View>
  );
});

const st = StyleSheet.create({
  root: { flexShrink: 1, minWidth: 0, justifyContent: "center", paddingVertical: 7, paddingRight: 4 },
  word: { flexDirection: "row", alignItems: "center" },
  letter: { fontFamily: "Outfit_700Bold", color: C.text, fontSize: 24, lineHeight: 32, letterSpacing: -0.6, includeFontPadding: false },
  sweepClip: { ...ABSOLUTE_FILL, overflow: "hidden", borderRadius: 6 },
  sweep: { position: "absolute", left: 0, top: -14, bottom: -14, width: 25 },
  fill: { flex: 1 },
  underline: { position: "absolute", left: 12, right: 12, bottom: 0, height: 2, borderRadius: 2, backgroundColor: C.mint },
  spark: { position: "absolute", left: 0, top: 0, width: 4, height: 4, borderRadius: 1 },
});
