import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../lib/auth";
import { getHistory, isCompleted, type WatchEntry } from "../lib/history";
import { countCompletedAnime } from "../lib/completion";
import { getFavorites, toAnimeUrl } from "../lib/favorites";
import { updateProfile } from "../lib/profile";
import { C, S, R, ELEVATION_CARD, ELEVATION_GLOW } from "../lib/theme";
import { t } from "../lib/i18n";
import { Aurora, ScreenHeader, SectionLabel, GlassIconButton } from "../components/ScreenChrome";

interface Stats {
  episodesWatched: number;
  watchHours: number;
  watchMins: number;
  animeInList: number;
  watching: number;
  planned: number;
  distinctAnime: number;
  completedAnime: number;
  recent: WatchEntry[];
}

const EMPTY: Stats = {
  episodesWatched: 0, watchHours: 0, watchMins: 0, animeInList: 0,
  watching: 0, planned: 0, distinctAnime: 0, completedAnime: 0, recent: [],
};

function arMonthYear(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  try {
    return d.toLocaleDateString("ar", { month: "long", year: "numeric" });
  } catch {
    return `${d.getMonth() + 1}/${d.getFullYear()}`;
  }
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>(EMPTY);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [picked, setPicked] = useState<{ uri: string; base64: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      Promise.all([getHistory(), getFavorites(), countCompletedAnime()])
        .then(([history, favs, completedAnime]) => {
          const completed = history.filter(isCompleted);
          const totalMs = history.reduce((sum, e) => sum + (e.positionMs || 0), 0);
          const totalMin = Math.floor(totalMs / 60000);
          const distinct = new Set(history.map((e) => e.animeHref || e.animeTitle)).size;
          setStats({
            episodesWatched: completed.length,
            watchHours: Math.floor(totalMin / 60),
            watchMins: totalMin % 60,
            animeInList: favs.length,
            watching: favs.filter((f) => f.list === "watching").length,
            planned: favs.filter((f) => f.list === "planned").length,
            distinctAnime: distinct,
            completedAnime,
            recent: history.slice(0, 6),
          });
        })
        .catch(() => {});
    }, []),
  );

  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    (user?.email ? user.email.split("@")[0] : t.guest);
  const bioText = (user?.user_metadata?.bio as string) || "";
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;
  const initial = (displayName || "?").trim().charAt(0).toUpperCase();
  const since = arMonthYear(user?.created_at);

  // The avatar currently shown: a freshly picked image (preview) wins, then the
  // saved metadata URL.
  const shownAvatar = picked?.uri || avatarUrl;

  // Seed the editable fields from the live metadata whenever it changes (and
  // when entering edit mode), so the form always reflects the saved truth.
  useEffect(() => {
    if (!editing) {
      setName(displayName === t.guest ? "" : displayName);
      setBio(bioText);
    }
  }, [displayName, bioText, editing]);

  const beginEdit = useCallback(() => {
    setName(displayName === t.guest ? "" : displayName);
    setBio(bioText);
    setPicked(null);
    setEditing(true);
  }, [displayName, bioText]);

  const cancelEdit = useCallback(() => {
    setPicked(null);
    setEditing(false);
  }, []);

  const pickAvatar = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t.editProfileTitle, t.profilePhotoPermission);
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      base64: true,
    });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    if (a.base64) setPicked({ uri: a.uri, base64: a.base64 });
  }, []);

  const onSave = useCallback(async () => {
    if (saving) return;
    if (!name.trim()) {
      Alert.alert(t.editProfileTitle, t.profileNameRequired);
      return;
    }
    setSaving(true);
    const r = await updateProfile({ name, bio, avatarBase64: picked?.base64 ?? null });
    setSaving(false);
    if (r.ok) {
      // user_metadata change fires USER_UPDATED → AuthProvider refreshes `user`,
      // so the displayed values update on their own. Drop the local preview.
      setPicked(null);
      setEditing(false);
    } else {
      Alert.alert(t.editProfileTitle, t.profileSaveError);
    }
  }, [saving, name, bio, picked]);

  const bigStats = [
    { icon: "play-circle", value: String(stats.episodesWatched), label: t.statsEpisodesWatched, tint: C.accent },
    { icon: "time", value: t.watchTimeValue(stats.watchHours, stats.watchMins), label: t.statsWatchTime, tint: C.violet },
    { icon: "albums", value: String(stats.animeInList), label: t.statsAnimeInList, tint: C.cyan },
  ] as const;

  const miniStats = [
    { icon: "play", value: stats.watching, label: t.statsWatching, color: C.success },
    { icon: "bookmark", value: stats.planned, label: t.statsPlanned, color: C.violet },
    { icon: "checkmark-done", value: stats.completedAnime, label: t.statsCompleted, color: C.success },
  ] as const;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader
        title={editing ? t.editProfileTitle : t.profileTitle}
        right={
          editing ? (
            <GlassIconButton icon="close" size={19} tint={C.textSecondary} onPress={cancelEdit} />
          ) : (
            <View style={s.headerActions}>
              <GlassIconButton icon="create-outline" size={19} tint={C.text} onPress={beginEdit} />
              <GlassIconButton icon="settings-outline" size={19} tint={C.textSecondary} onPress={() => router.push("/settings")} />
            </View>
          )
        }
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 50}
      >
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {/* Hero */}
        <View style={s.hero}>
          <Pressable onPress={editing ? pickAvatar : undefined} disabled={!editing}>
            <LinearGradient
              colors={[C.accent, C.violet]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.avatarRing}
            >
              {shownAvatar ? (
                <Image source={{ uri: shownAvatar }} style={s.avatar} contentFit="cover" transition={150} />
              ) : (
                <View style={[s.avatar, s.avatarFallback]}>
                  <Text style={s.avatarInitial}>{initial}</Text>
                </View>
              )}
            </LinearGradient>
            {editing ? (
              <View style={s.avatarBadge}>
                <Ionicons name="camera" size={15} color={C.textOnAccent} />
              </View>
            ) : null}
          </Pressable>

          {editing ? (
            <View style={s.editForm}>
              <Text style={s.fieldLabel}>{t.profileNameLabel}</Text>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder={t.profileNamePlaceholder}
                placeholderTextColor={C.textMuted}
                textAlign="right"
                maxLength={40}
              />

              <Text style={[s.fieldLabel, { marginTop: 16 }]}>{t.profileBioLabel}</Text>
              <TextInput
                style={s.bioInput}
                value={bio}
                onChangeText={setBio}
                placeholder={t.profileBioPlaceholder}
                placeholderTextColor={C.textMuted}
                multiline
                textAlign="right"
                textAlignVertical="top"
                maxLength={160}
              />

              <View style={s.editActions}>
                <Pressable
                  style={[s.saveBtn, saving && { opacity: 0.7 }]}
                  onPress={onSave}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color={C.textOnAccent} />
                  ) : (
                    <Ionicons name="checkmark" size={17} color={C.textOnAccent} />
                  )}
                  <Text style={s.saveText}>{saving ? t.profileSaving : t.profileSave}</Text>
                </Pressable>
                <Pressable style={s.cancelBtn} onPress={cancelEdit} disabled={saving}>
                  <Text style={s.cancelText}>{t.profileCancel}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <Text style={s.name}>{displayName}</Text>
              {user?.email ? <Text style={s.email} numberOfLines={1}>{user.email}</Text> : null}
              {bioText ? <Text style={s.bio}>{bioText}</Text> : null}
              {since ? (
                <View style={s.sinceChip}>
                  <Ionicons name="sparkles" size={11} color={C.violet} />
                  <Text style={s.sinceText}>{t.memberSince(since)}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>

        {!editing && (
        <>
        {/* Big stats */}
        <View style={s.bigStatsRow}>
          {bigStats.map((st2, i) => (
            <View key={st2.label} style={[s.bigStatCard, i > 0 && s.colSpace, { borderColor: st2.tint + "2E" }]}>
              <LinearGradient
                colors={[st2.tint + "1A", "transparent"]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={[s.bigStatIcon, { backgroundColor: st2.tint + "22" }]}>
                <Ionicons name={st2.icon as any} size={17} color={st2.tint} />
              </View>
              <Text style={s.bigStatValue} numberOfLines={1} adjustsFontSizeToFit>{st2.value}</Text>
              <Text style={s.bigStatLabel}>{st2.label}</Text>
            </View>
          ))}
        </View>

        {/* Mini stats */}
        <View style={s.miniRow}>
          {miniStats.map((m, i) => (
            <View key={m.label} style={[s.miniCard, i > 0 && s.colSpace]}>
              <View style={[s.miniIcon, { backgroundColor: m.color + "22" }]}>
                <Ionicons name={m.icon as any} size={14} color={m.color} />
              </View>
              <View style={s.miniText}>
                <Text style={s.miniValue}>{m.value}</Text>
                <Text style={s.miniLabel} numberOfLines={1}>{m.label}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Recent activity */}
        <View style={s.section}>
          <SectionLabel>{t.recentActivity}</SectionLabel>
        </View>
        {stats.recent.length === 0 ? (
          <View style={s.emptyActivity}>
            <View style={s.emptyIcon}>
              <Ionicons name="film-outline" size={26} color={C.textMuted} />
            </View>
            <Text style={s.emptyText}>{t.noActivity}</Text>
          </View>
        ) : (
          <View style={s.recentList}>
            {stats.recent.map((e) => (
              <Pressable
                key={e.episodeHref}
                style={({ pressed }) => [s.recentItem, pressed && s.recentItemPressed]}
                onPress={() => {
                  const params: Record<string, string> = {};
                  if (e.image) params.img = encodeURIComponent(e.image);
                  if (e.url4up) params.url4up = encodeURIComponent(e.url4up);
                  const rawAnime = e.animeHref || e.episodeHref;
                  const animeUrl = rawAnime?.includes("/anime/") ? rawAnime : toAnimeUrl(rawAnime) ?? "";
                  if (animeUrl) params.anime = animeUrl;
                  router.push({ pathname: `/watch/${encodeURIComponent(e.episodeHref)}`, params });
                }}
              >
                {isCompleted(e) ? <Ionicons name="checkmark-circle" size={18} color={C.success} style={s.recentCheck} /> : null}
                <View style={s.recentBody}>
                  <Text style={s.recentTitle} numberOfLines={1}>{e.episodeTitle || e.animeTitle}</Text>
                  <Text style={s.recentSub} numberOfLines={1}>{e.animeTitle}</Text>
                </View>
                {e.image ? (
                  <Image source={{ uri: e.image }} style={s.recentThumb} contentFit="cover" transition={120} />
                ) : (
                  <View style={[s.recentThumb, s.recentThumbFallback]}>
                    <Ionicons name="film-outline" size={18} color={C.textMuted} />
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        )}
        </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Shared horizontal spacer between equal-width cards (margins, not row gap).
  colSpace: { marginLeft: 10 },

  hero: { alignItems: "center", paddingVertical: 20, paddingHorizontal: S.paddingContent },
  avatarRing: {
    width: 102, height: 102, borderRadius: R.circle,
    alignItems: "center", justifyContent: "center", padding: 3,
  },
  avatar: { width: "100%", height: "100%", borderRadius: R.circle },
  avatarFallback: { backgroundColor: C.bgDeep, alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: C.text, fontSize: 40, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  avatarBadge: {
    position: "absolute", right: 0, bottom: 0,
    width: 34, height: 34, borderRadius: R.circle,
    backgroundColor: C.accent, alignItems: "center", justifyContent: "center",
    borderWidth: 3, borderColor: C.bg, ...ELEVATION_GLOW,
  },
  // Name now wraps (was numberOfLines={1} → long Arabic names truncated).
  name: {
    color: C.text, fontSize: 23, fontWeight: "800", fontFamily: "Cairo_700Bold",
    marginTop: 16, textAlign: "center", paddingHorizontal: S.paddingContent,
  },
  email: { color: C.textSecondary, fontSize: 13, marginTop: 5, fontFamily: "Cairo_500Medium" },
  // Bio: full multi-line wrapping, no height clamp — the truncation fix.
  bio: {
    color: C.textSoft, fontSize: 14, lineHeight: 22, fontFamily: "Cairo_500Medium",
    textAlign: "center", marginTop: 12, paddingHorizontal: S.paddingContent,
    alignSelf: "stretch",
  },

  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },

  // Edit form
  editForm: { width: "100%", marginTop: 18 },
  fieldLabel: {
    color: C.textSecondary, fontSize: 12, fontFamily: "Cairo_600SemiBold",
    textAlign: "right", marginBottom: 8,
  },
  input: {
    height: 52, borderRadius: R.lg, paddingHorizontal: 16,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    color: C.text, fontSize: 14, fontFamily: "Cairo_500Medium",
  },
  bioInput: {
    minHeight: 96, borderRadius: R.xl, padding: 16,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    color: C.text, fontSize: 14, lineHeight: 22, fontFamily: "Cairo_500Medium",
  },
  editActions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 22 },
  saveBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 52, borderRadius: R.pill, backgroundColor: C.accent, ...ELEVATION_GLOW,
  },
  saveText: { color: C.textOnAccent, fontSize: 15, fontWeight: "700", fontFamily: "Cairo_700Bold" },
  cancelBtn: {
    paddingHorizontal: 22, height: 52, alignItems: "center", justifyContent: "center",
    borderRadius: R.pill, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  cancelText: { color: C.textSecondary, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_700Bold" },

  sinceChip: {
    flexDirection: "row", alignItems: "center", marginTop: 12,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: R.pill,
    backgroundColor: C.violetSoft, borderWidth: 1, borderColor: C.borderViolet,
  },
  sinceText: { color: C.textSoft, fontSize: 12, fontFamily: "Cairo_600SemiBold", marginLeft: 6 },

  bigStatsRow: { flexDirection: "row", paddingHorizontal: S.paddingContent, marginTop: 8 },
  bigStatCard: {
    flex: 1, alignItems: "center", paddingVertical: 18, borderRadius: R.xl,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    overflow: "hidden",
    ...ELEVATION_CARD,
  },
  bigStatIcon: { width: 36, height: 36, borderRadius: R.circle, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  bigStatValue: { color: C.text, fontSize: 18, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  bigStatLabel: { color: C.textSecondary, fontSize: 10, textAlign: "center", marginTop: 4, fontFamily: "Cairo_500Medium" },

  miniRow: { flexDirection: "row", paddingHorizontal: S.paddingContent, marginTop: 10 },
  miniCard: {
    flex: 1, flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: R.lg, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  miniIcon: { width: 30, height: 30, borderRadius: R.circle, alignItems: "center", justifyContent: "center", marginRight: 10 },
  miniText: { flex: 1, alignItems: "flex-end" },
  miniValue: { color: C.text, fontSize: 17, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  miniLabel: { color: C.textMuted, fontSize: 10, fontFamily: "Cairo_500Medium" },

  section: { paddingHorizontal: S.paddingContent, marginTop: 28 },

  recentList: { paddingHorizontal: S.paddingContent },
  recentItem: {
    flexDirection: "row", alignItems: "center", padding: 8, marginBottom: 8,
    borderRadius: R.lg, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  recentItemPressed: { backgroundColor: C.surfaceLight, transform: [{ scale: 0.99 }] },
  recentCheck: { marginRight: 12 },
  recentBody: { flex: 1, marginRight: 12 },
  recentThumb: { width: 64, height: 40, borderRadius: R.sm },
  recentThumbFallback: { backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  recentTitle: { color: C.text, fontSize: 13, fontWeight: "600", fontFamily: "Cairo_600SemiBold", textAlign: "right" },
  recentSub: { color: C.textMuted, fontSize: 11, marginTop: 2, fontFamily: "Cairo_500Medium", textAlign: "right" },

  emptyActivity: { alignItems: "center", paddingVertical: 36 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: R.circle, marginBottom: 12,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  emptyText: { color: C.textMuted, fontSize: 13, fontFamily: "Cairo_500Medium" },
});
