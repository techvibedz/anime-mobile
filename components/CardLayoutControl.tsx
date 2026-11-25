import { Pressable, StyleSheet } from "react-native";
import { LiquidGlass } from "./LiquidGlass";
import { Ionicons } from "@expo/vector-icons";
import { C } from "../lib/theme";

import { nextCardLayout, type CardLayout } from "../lib/cardLayout";
import { t } from "../lib/i18n";

const OPTIONS: Record<CardLayout, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  compact: { icon: "apps-outline", label: t.cardLayoutCompact },
  comfortable: { icon: "grid-outline", label: t.cardLayoutComfortable },
  list: { icon: "list-outline", label: t.cardLayoutList },
};

/** One press cycles compact → comfortable → list → compact. The icon is the current layout. */
export function CardLayoutControl({ layout, onChange }: {
  layout: CardLayout;
  onChange: (layout: CardLayout) => void;
}) {
  const current = OPTIONS[layout];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t.cardLayout}: ${current.label}`}
      accessibilityHint={t.cardLayoutHint}
      onPress={() => onChange(nextCardLayout(layout))}
      style={({ pressed }) => [pressed && s.pressed]}
    >
      <LiquidGlass preset="compactControl" radius={24} interactive edgeReflectionStrength={0.3} style={s.trigger}>
        <Ionicons name={current.icon} size={21} color={C.accent} />
      </LiquidGlass>
    </Pressable>
  );
}

const s = StyleSheet.create({
  trigger: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  pressed: { transform: [{ scale: 0.94 }] },
});
