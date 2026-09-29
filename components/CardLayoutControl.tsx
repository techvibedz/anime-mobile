import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C, R } from "../lib/theme";
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
      style={({ pressed }) => [s.trigger, pressed && s.pressed]}
    >
      <Ionicons name={current.icon} size={21} color={C.accent} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  trigger: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: R.md, backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderSoft },
  pressed: { opacity: 0.75 },
});
