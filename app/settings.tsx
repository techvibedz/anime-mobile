import { useCallback, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Alert,
  I18nManager,
  ActivityIndicator,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
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
} from "../lib/push";
import { checkForApkUpdate, checkForOtaUpdate, openApkDownload, applyOtaUpdate } from "../lib/updater";
import { C, S, R, ELEVATION_CARD, ELEVATION_GLOW } from "../lib/theme";
import { t } from "../lib/i18n";

const HISTORY_KEY = "watch_history";

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

  const version = Constants.expoConfig?.version ?? "1.3.1";

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <Ionicons name={I18nManager.isRTL ? "chevron-forward" : "chevron-back"} size={22} color={C.white} />
        </Pressable>
        <Text style={s.heading}>{t.settingsTitle}</Text>
        <View style={s.headerSpacer} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: S.paddingContent, paddingBottom: insets.bottom + 40 }}>
        {/* General */}
        <Text style={s.groupTitle}>{t.settingsGeneral}</Text>
        <View style={s.group}>
          <ToggleRow
            icon="notifications-outline"
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
            title={t.settingsAutoplay}
            desc={t.settingsAutoplayDesc}
            value={autoplay}
            onChange={toggleAutoplay}
          />
        </View>

        {/* Data */}
        <Text style={s.groupTitle}>{t.settingsData}</Text>
        <View style={s.group}>
          <ActionRow icon="trash-bin-outline" title={t.settingsClearCache} desc={t.settingsClearCacheDesc} onPress={onClearCache} />
          <Divider />
          <ActionRow icon="time-outline" title={t.settingsClearHistory} desc={t.settingsClearHistoryDesc} onPress={onClearHistory} danger />
        </View>

        {/* About */}
        <Text style={s.groupTitle}>{t.settingsAbout}</Text>
        <View style={s.group}>
          <ActionRow
            icon="cloud-download-outline"
            title={t.settingsCheckUpdate}
            desc={`${t.settingsVersion} ${version}`}
            onPress={onCheckUpdate}
            right={checking ? <ActivityIndicator size="small" color={C.accent} /> : undefined}
          />
        </View>

        {/* Brand footer */}
        <View style={s.brandFooter}>
          <Text style={s.brandName}>{t.settingsAppName}</Text>
          <Text style={s.brandTag}>{t.settingsTagline}</Text>
          <Text style={s.brandVersion}>v{version}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

/* ── Rows ────────────────────────────────────── */

function ToggleRow({
  icon, title, desc, value, onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={s.row}>
      <View style={s.rowIcon}><Ionicons name={icon} size={19} color={C.text} /></View>
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={s.rowDesc} numberOfLines={2}>{desc}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: C.surfaceLight, true: C.accent }}
        thumbColor="#fff"
        ios_backgroundColor={C.surfaceLight}
      />
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
      <View style={s.rowIcon}><Ionicons name="funnel-outline" size={19} color={C.text} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{t.settingsNotifScope}</Text>
        <Text style={s.rowDesc}>{t.settingsNotifScopeDesc}</Text>
        <View style={s.segment}>
          {options.map((opt) => {
            const active = scope === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => onChange(opt.key)}
                style={[s.segmentBtn, active && s.segmentBtnActive]}
              >
                <Ionicons name={opt.icon} size={14} color={active ? C.textOnAccent : C.textSecondary} />
                <Text style={[s.segmentText, active && s.segmentTextActive]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function ActionRow({
  icon, title, desc, onPress, danger, right,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  onPress: () => void;
  danger?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <Pressable style={({ pressed }) => [s.row, pressed && { backgroundColor: C.glass }]} onPress={onPress}>
      <View style={[s.rowIcon, danger && { backgroundColor: C.accentSoft }]}>
        <Ionicons name={icon} size={19} color={danger ? C.accent : C.text} />
      </View>
      <View style={s.rowText}>
        <Text style={[s.rowTitle, danger && { color: C.accent }]}>{title}</Text>
        <Text style={s.rowDesc} numberOfLines={2}>{desc}</Text>
      </View>
      {right ?? <Ionicons name="chevron-back" size={18} color={C.textMuted} />}
    </Pressable>
  );
}

function Divider() {
  return <View style={s.divider} />;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: S.paddingContent, paddingVertical: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  headerSpacer: { width: 40, height: 40 },
  heading: { flex: 1, textAlign: "center", color: C.text, fontSize: 18, fontWeight: "700", fontFamily: "Outfit_700Bold" },

  groupTitle: {
    color: C.textSecondary, fontSize: 12, fontWeight: "700", fontFamily: "Outfit_700Bold",
    marginTop: 24, marginBottom: 10, marginHorizontal: 6, textAlign: "right",
  },
  group: {
    borderRadius: R.lg, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    overflow: "hidden", ...ELEVATION_CARD,
  },
  row: {
    flexDirection: "row-reverse", alignItems: "center", gap: 14,
    paddingVertical: 15, paddingHorizontal: 14,
  },
  rowIcon: {
    width: 38, height: 38, borderRadius: R.md,
    backgroundColor: C.surfaceLight, alignItems: "center", justifyContent: "center",
  },
  rowText: { flex: 1 },
  rowTitle: { color: C.text, fontSize: 14, fontWeight: "600", fontFamily: "DMSans_600SemiBold", textAlign: "right" },
  rowDesc: { color: C.textMuted, fontSize: 11.5, marginTop: 4, lineHeight: 17, fontFamily: "DMSans_500Medium", textAlign: "right" },
  divider: { height: 1, backgroundColor: C.border, marginRight: 66 },

  scopeRow: { flexDirection: "row-reverse", gap: 14, paddingVertical: 15, paddingHorizontal: 14 },
  segment: {
    flexDirection: "row-reverse", gap: 6, marginTop: 14,
    padding: 4, borderRadius: R.pill,
    backgroundColor: C.bgDeep, borderWidth: 1, borderColor: C.glassBorder,
  },
  segmentBtn: {
    flex: 1, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: R.pill,
  },
  segmentBtnActive: { backgroundColor: C.accent, ...ELEVATION_GLOW },
  segmentText: { color: C.textSecondary, fontSize: 12.5, fontWeight: "700", fontFamily: "DMSans_600SemiBold" },
  segmentTextActive: { color: C.textOnAccent },

  brandFooter: { alignItems: "center", marginTop: 40, gap: 4 },
  brandName: { color: C.accent, fontSize: 20, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  brandTag: { color: C.textSecondary, fontSize: 12, fontFamily: "DMSans_500Medium" },
  brandVersion: { color: C.textMuted, fontSize: 11, marginTop: 6, fontFamily: "DMSans_500Medium" },
});
