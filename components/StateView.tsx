// Unified empty / error / offline / loading state. Replaces the 5+ divergent
// "nothing here" layouts that previously differed in icon size, circle fill,
// button treatment, and copy tone across Home, Search, MyList, Detail, and the
// shared OfflineNotice.
//
// One anatomy: centered icon disc → title → message → optional primary
// (ember) + secondary (ghost) actions. Ember is reserved for the primary
// recovery action only, per the Sumi "earn every glow" principle.

import { type ReactNode } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C, R, TAr } from "../lib/theme";

export interface StateAction {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}

export function StateView({
  icon,
  variant = "empty",
  title,
  message,
  primary,
  secondary,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  variant?: "empty" | "offline" | "error" | "loading";
  title: string;
  message?: string;
  primary?: StateAction;
  secondary?: StateAction;
  children?: ReactNode;
}) {
  const isOffline = variant === "offline";
  const isError = variant === "error";
  const isLoading = variant === "loading";
  const iconTint = isOffline || isError ? C.ember : C.textMuted;

  return (
    <View style={s.wrap}>
      <View style={s.disc}>
        {isLoading ? (
          <ActivityIndicator size="large" color={C.ember} />
        ) : (
          <Ionicons name={icon} size={36} color={iconTint} />
        )}
      </View>
      <Text style={s.title}>{title}</Text>
      {message ? <Text style={s.message}>{message}</Text> : null}
      {primary && (
        <Pressable
          style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.9 }]}
          onPress={primary.onPress}
        >
          {primary.icon ? <Ionicons name={primary.icon} size={16} color={C.textOnAccent} /> : null}
          <Text style={s.primaryText}>{primary.label}</Text>
        </Pressable>
      )}
      {secondary && (
        <Pressable
          style={({ pressed }) => [s.secondaryBtn, pressed && { opacity: 0.85 }]}
          onPress={secondary.onPress}
        >
          {secondary.icon ? <Ionicons name={secondary.icon} size={15} color={C.text} /> : null}
          <Text style={s.secondaryText}>{secondary.label}</Text>
        </Pressable>
      )}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 32, paddingTop: 72, paddingBottom: 40, gap: 12,
  },
  disc: {
    width: 80, height: 80, borderRadius: R.circle,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
  },
  title: { ...TAr.h2, color: C.text, textAlign: "center" },
  message: {
    ...TAr.body, color: C.textSecondary, textAlign: "center", maxWidth: 300,
  },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.ember, borderRadius: R.pill,
    paddingHorizontal: 24, paddingVertical: 13, marginTop: 8,
  },
  primaryText: { ...TAr.bodySmall, color: C.textOnAccent, fontWeight: "700" },
  secondaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: R.pill, paddingHorizontal: 22, paddingVertical: 11,
  },
  secondaryText: { ...TAr.bodySmall, color: C.text },
});
