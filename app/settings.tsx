import { useCallback, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getNotificationsEnabled,
  setNotificationsEnabled,
  getAutoplayNext,
  setAutoplayNext,
  getNotificationScope,
  setNotificationScope,
  clearContentCache,
  type NotificationScope,
} from "../lib/settings";
import {
  requestNotificationPermission,
  hasNotificationPermission,
  notificationsModuleAvailable,
  updateNotificationScopeRemote,
  updateNotificationsEnabledRemote,
} from "../lib/push";
import { checkForApkUpdate, checkForOtaUpdate, openApkDownload, applyOtaUpdate } from "../lib/updater";
import { C, S, R, ELEVATION_CARD, ELEVATION_GLOW } from "../lib/theme";
import { t } from "../lib/i18n";
import { Aurora, ScreenHeader, SectionLabel } from "../components/ScreenChrome";

const HISTORY_KEY = "watch_history";

// Always plain "row" — never "row-reverse" (RN 0.81 Yoga bug collapses mixed
// fixed+flex rows into a vertical stack). Arabic order is achieved by laying
// the control out first and the icon last, with right-aligned text between.

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [notifs, setNotifs] = useState(true);
  const [autoplay, setAutoplay] = useState(true);
  const [scope, setScope] = useState<NotificationScope>("all");
  const [permGranted, setPermGranted] = useState(false);
  const [checking, setChecking] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getNotificationsEnabled().then(setNotifs);
      getAutoplayNext().then(setAutoplay);
      getNotificationScope().then(setScope);
      hasNotificationPermission().then(setPermGranted);
    }, []),
  );

  const changeScope = useCallback(async (value: NotificationScope) => {
    setScope(value);
    await setNotificationScope(value);
    // Sync to the server so closed-app push honors the change immediately.
    void updateNotificationScopeRemote(value);
  }, []);

  const toggleNotifs = useCallback(async (value: boolean) => {
    if (value && notificationsModuleAvailable()) {
      const granted = await requestNotificationPermission();
      setPermGranted(granted);
      if (!granted) {
        Alert.alert(t.settingsNotifications, t.enableNotifsPrompt);
        // Still allow the in-app preference to be on; OS-level alerts just
        // won't show until the user grants permission in system settings.
      }
    }
    setNotifs(value);
    await setNotificationsEnabled(value);
    // Sync to the server so closed-app push stops/resumes immediately.
    void updateNotificationsEnabledRemote(value);
  }, []);

  const toggleAutoplay = useCallback(async (value: boolean) => {
    setAutoplay(value);
    await setAutoplayNext(value);
  }, []);

  const onClearCache = useCallback(async () => {
    const n = await clearContentCache();
    Alert.alert(t.settingsClearCache, t.cacheCleared(n));
  }, []);

  const onClearHistory = useCallback(() => {
    Alert.alert(t.settingsClearHistory, t.confirmClearHistory, [
      { text: t.cancel, style: "cancel" },
      {
        text: t.confirm,
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.removeItem(HISTORY_KEY);
          Alert.alert(t.settingsClearHistory, t.historyCleared);
        },
      },
    ]);
  }, []);

  const onCheckUpdate = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      const apk = await checkForApkUpdate();
      if (apk?.apkUrl) {
        Alert.alert(
          t.settingsCheckUpdate,
          apk.releaseNotes || `${t.settingsVersion} ${apk.version}`,
          [
            { text: t.cancel, style: "cancel" },
            { text: t.notifWatchNow, onPress: () => openApkDownload(apk.apkUrl!) },
          ],
        );
        return;
      }
      const ota = await checkForOtaUpdate();
      if (ota) {
        applyOtaUpdate();
        return;
      }
      Alert.alert(t.settingsCheckUpdate, t.noUpdates);
    } finally {
      setChecking(false);
    }
  }, [checking]);

  const version = Constants.expoConfig?.version ?? "1.4.0";

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.settingsTitle} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: S.paddingContent, paddingBottom: insets.bottom + 40 }}>
        {/* General */}
        <SectionLabel>{t.settingsGeneral}</SectionLabel>
        <View style={s.group}>
          <ToggleRow
            icon="notifications-outline"
            tint={C.accent}
            title={t.settingsNotifications}
            desc={
              notificationsModuleAvailable() && !permGranted && notifs
                ? t.settingsPermissionNeeded
                : t.settingsNotificationsDesc
            }
            value={notifs}
            onChange={toggleNotifs}
          />
          {notifs && (
            <>
              <Divider />
              <ScopeRow scope={scope} onChange={changeScope} />
            </>
          )}
          <Divider />
          <ToggleRow
            icon="play-forward-outline"
            tint={C.violet}
            title={t.settingsAutoplay}
            desc={t.settingsAutoplayDesc}
            value={autoplay}
            onChange={toggleAutoplay}
          />
        </View>

        {/* Data */}
        <View style={s.sectionGap} />
        <SectionLabel>{t.settingsData}</SectionLabel>
        <View style={s.group}>
          <ActionRow icon="trash-bin-outline" tint={C.cyan} title={t.settingsClearCache} desc={t.settingsClearCacheDesc} onPress={onClearCache} />
          <Divider />
          <ActionRow icon="time-outline" title={t.settingsClearHistory} desc={t.settingsClearHistoryDesc} onPress={onClearHistory} danger />
        </View>

        {/* About */}
        <View style={s.sectionGap} />
        <SectionLabel>{t.settingsAbout}</SectionLabel>
        <View style={s.group}>
          <ActionRow
            icon="cloud-download-outline"
            tint={C.violet}
            title={t.settingsCheckUpdate}
            desc={`${t.settingsVersion} ${version}`}
            onPress={onCheckUpdate}
            right={checking ? <ActivityIndicator size="small" color={C.accent} /> : undefined}
          />
        </View>

        {/* Brand footer */}
        <View style={s.brandFooter}>
          <LinearLogoMark />
          <Text style={s.brandName}>{t.settingsAppName}</Text>
          <Text style={s.brandTag}>{t.settingsTagline}</Text>
          <Text style={s.brandVersion}>v{version}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

/* ── Brand mark ──────────────────────────────── */
function LinearLogoMark() {
  return (
    <View style={s.logoMark}>
      <Text style={s.logoGlyph}>P</Text>
    </View>
  );
}

/* ── Rows ────────────────────────────────────── */
// Visual order is [control] · [text (right-aligned)] · [icon] so the icon rail
// hugs the right edge for Arabic readers.

function RowIcon({ icon, tint, danger }: { icon: keyof typeof Ionicons.glyphMap; tint?: string; danger?: boolean }) {
  const color = danger ? C.accent : tint ?? C.text;
  const bg = danger ? C.accentSoft : tint ? tint + "1F" : C.surfaceLight;
  return (
    <View style={[s.rowIcon, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={19} color={color} />
    </View>
  );
}

function ToggleRow({
  icon, tint, title, desc, value, onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint?: string;
  title: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={s.row}>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: C.surfaceLight, true: C.accent }}
        thumbColor="#fff"
        ios_backgroundColor={C.surfaceLight}
      />
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={s.rowDesc} numberOfLines={2}>{desc}</Text>
      </View>
      <RowIcon icon={icon} tint={tint} />
    </View>
  );
}

function ScopeRow({
  scope, onChange,
}: {
  scope: NotificationScope;
  onChange: (v: NotificationScope) => void;
}) {
  const options: { key: NotificationScope; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: "all", label: t.scopeAll, icon: "earth" },
    { key: "mylist", label: t.scopeMyList, icon: "heart" },
  ];
  return (
    <View style={s.scopeRow}>
      <View style={s.scopeHead}>
        <View style={s.scopeBody}>
          <Text style={s.rowTitle}>{t.settingsNotifScope}</Text>
          <Text style={s.rowDesc}>{t.settingsNotifScopeDesc}</Text>
        </View>
        <RowIcon icon="funnel-outline" tint={C.gold} />
      </View>
      <View style={s.segment}>
        {options.map((opt, i) => {
          const active = scope === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => onChange(opt.key)}
              style={[s.segmentBtn, i > 0 && { marginLeft: 6 }, active && s.segmentBtnActive]}
            >
              <Ionicons name={opt.icon} size={14} color={active ? C.textOnAccent : C.textSecondary} />
              <Text style={[s.segmentText, active && s.segmentTextActive]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ActionRow({
  icon, tint, title, desc, onPress, danger, right,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint?: string;
  title: string;
  desc: string;
  onPress: () => void;
  danger?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <Pressable style={({ pressed }) => [s.row, pressed && { backgroundColor: C.glass }]} onPress={onPress}>
      {right ?? <Ionicons name="chevron-back" size={18} color={C.textMuted} />}
      <View style={s.rowText}>
        <Text style={[s.rowTitle, danger && { color: C.accent }]}>{title}</Text>
        <Text style={s.rowDesc} numberOfLines={2}>{desc}</Text>
      </View>
      <RowIcon icon={icon} tint={tint} danger={danger} />
    </Pressable>
  );
}

function Divider() {
  return <View style={s.divider} />;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  sectionGap: { height: 24 },
  group: {
    borderRadius: R.xl, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    overflow: "hidden", ...ELEVATION_CARD,
  },
  row: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 15, paddingHorizontal: 14,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: R.md, marginLeft: 14,
    alignItems: "center", justifyContent: "center",
  },
  rowText: { flex: 1, marginLeft: 14 },
  rowTitle: { color: C.text, fontSize: 14.5, fontWeight: "600", fontFamily: "DMSans_600SemiBold", textAlign: "right" },
  rowDesc: { color: C.textMuted, fontSize: 11.5, marginTop: 4, lineHeight: 17, fontFamily: "DMSans_500Medium", textAlign: "right" },
  // Indent the divider so it stops short of the icon rail on the right.
  divider: { height: 1, backgroundColor: C.border, marginLeft: 14, marginRight: 68 },

  scopeRow: { paddingVertical: 15, paddingHorizontal: 14 },
  scopeHead: { flexDirection: "row", alignItems: "flex-start" },
  scopeBody: { flex: 1 },
  segment: {
    flexDirection: "row", marginTop: 14,
    padding: 4, borderRadius: R.pill,
    backgroundColor: C.bgDeep, borderWidth: 1, borderColor: C.glassBorder,
  },
  segmentBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 10, borderRadius: R.pill,
  },
  segmentBtnActive: { backgroundColor: C.accent, ...ELEVATION_GLOW },
  segmentText: { color: C.textSecondary, fontSize: 12.5, fontWeight: "700", fontFamily: "DMSans_600SemiBold", marginLeft: 6 },
  segmentTextActive: { color: C.textOnAccent },

  brandFooter: { alignItems: "center", marginTop: 44, gap: 4 },
  logoMark: {
    width: 52, height: 52, borderRadius: 16, marginBottom: 10,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
    alignItems: "center", justifyContent: "center",
  },
  logoGlyph: { color: C.accent, fontSize: 26, fontWeight: "900", fontFamily: "Outfit_900Black" },
  brandName: { color: C.text, fontSize: 19, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  brandTag: { color: C.textSecondary, fontSize: 12, fontFamily: "DMSans_500Medium" },
  brandVersion: { color: C.textMuted, fontSize: 11, marginTop: 6, fontFamily: "DMSans_500Medium" },
});
