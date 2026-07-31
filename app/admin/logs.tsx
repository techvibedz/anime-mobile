import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../../lib/auth";
import { isAdmin } from "../../lib/presence";
import { C, S, R, ELEVATION_CARD } from "../../lib/theme";
import { Aurora, ScreenHeader } from "../../components/ScreenChrome";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";

type Level = "error" | "warn" | "info";
type Filter = Level | "all";

interface LogRow {
  id: string;
  email: string | null;
  level: string;
  tag: string;
  message: string;
  context: Record<string, unknown> | null;
  app_version: string | null;
  platform: string | null;
  device: string | null;
  os_version: string | null;
  created_at: string;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "error", label: "أخطاء" },
  { key: "warn", label: "تحذيرات" },
  { key: "info", label: "معلومات" },
];

const LEVEL_TINT: Record<string, { dot: string; bar: string; text: string; soft: string }> = {
  error: { dot: C.accent, bar: C.accent, text: C.accent, soft: C.accentSoft },
  warn: { dot: "#FBBF24", bar: "#FBBF24", text: "#FBBF24", soft: "rgba(251,191,36,0.14)" },
  info: { dot: C.mint, bar: C.mint, text: C.mint, soft: C.mintSoft },
};

// Relative Arabic time ("قبل 5 د") for recent, absolute dd/mm HH:MM for older.
function when(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return iso;
  if (ms < 60000) return "الآن";
  if (ms < 3600000) return `قبل ${Math.floor(ms / 60000)} د`;
  if (ms < 86400000) return `قبل ${Math.floor(ms / 3600000)} س`;
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Cheap change-detection for the 15s poll: if the newest id and the row count
// didn't move, the payload is effectively identical and we skip setRows —
// before this, every poll re-rendered all 200 cards for nothing.
function rowsSignature(rows: LogRow[]): string {
  return `${rows.length}:${rows[0]?.id ?? ""}`;
}

export default function LogsScreen() {
  const insets = useSafeAreaInsets();
  const { user, ready } = useAuth();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const sigRef = useRef("");

  const admin = isAdmin(user?.email);

  useEffect(() => {
    if (ready && !admin) router.replace("/(tabs)");
  }, [ready, admin]);

  // Always fetch UNFILTERED and filter client-side. Filtering server-side made
  // the summary counts collapse to 0 for every other level (they were computed
  // from the filtered rows), and it forced a refetch + full re-render on every
  // chip tap. One query, instant chips, correct counts.
  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !admin) return;
    try {
      const { data, error } = await supabase.rpc("admin_list_logs", {
        p_limit: 200,
        p_level: null,
      });
      if (error) {
        console.warn("[logs] fetch failed:", error.message);
        return;
      }
      const next = (data ?? []) as LogRow[];
      const sig = rowsSignature(next);
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setRows(next);
      }
    } catch (e) {
      console.warn("[logs] threw:", e);
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, [admin]);

  useEffect(() => {
    if (admin) void load();
  }, [admin, load]);

  // Auto-refresh every 15s while the screen is open and admin.
  useEffect(() => {
    if (!admin) return;
    const iv = setInterval(() => void load(), 15000);
    return () => clearInterval(iv);
  }, [admin, load]);

  const counts = useMemo(() => {
    let error = 0, warn = 0, info = 0;
    for (const r of rows) {
      if (r.level === "error") error++;
      else if (r.level === "warn") warn++;
      else if (r.level === "info") info++;
    }
    return { error, warn, info };
  }, [rows]);

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.level === filter)),
    [rows, filter],
  );

  const toggleRow = useCallback((id: string) => {
    setOpenId((cur) => (cur === id ? null : id));
  }, []);

  if (!admin) return null;

  const header = (
    <>
      {/* Summary strip — three colored counts, one line */}
      <View style={s.summary}>
        <LinearGradient colors={[C.accentSoft, "transparent"]} style={StyleSheet.absoluteFill} />
        <SummaryPill icon="bug" count={counts.error} label="أخطاء" tint={C.accent} />
        <SummaryPill icon="warning" count={counts.warn} label="تحذيرات" tint="#FBBF24" />
        <SummaryPill icon="information" count={counts.info} label="معلومات" tint={C.mint} />
        {counts.error + counts.warn === 0 && (
          <View style={s.healthy}>
            <Ionicons name="shield-checkmark" size={14} color={C.success} />
            <Text style={s.healthyText}>سليم</Text>
          </View>
        )}
      </View>

      {/* Filter chips */}
      <View style={s.chips}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const n = f.key === "all" ? rows.length : counts[f.key as Level] ?? 0;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[s.chip, active && s.chipActive]}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>{f.label}</Text>
              <Text style={[s.chipCount, active && s.chipCountActive]}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );

  const empty = !loaded ? (
    <View style={s.center}>
      <ActivityIndicator size="large" color={C.accent} />
    </View>
  ) : (
    <View style={s.center} pointerEvents="none">
      <View style={s.emptyIcon}>
        <Ionicons name="checkmark-done-circle-outline" size={44} color={C.mint} />
      </View>
      <Text style={s.emptyTitle}>لا توجد سجلات</Text>
      <Text style={s.emptySub}>عندما يواجه المستخدمون أخطاء، تظهر تفاصيلها هنا تلقائيًا.</Text>
    </View>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title="سجل الأخطاء" onBack={() => router.back()} />

      {/* FlatList, not ScrollView: up to 200 cards must virtualize — the old
          ScrollView mounted every card at once and re-rendered all of them on
          each 15s poll, which is what made the page stutter. */}
      <FlatList
        data={visible}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => (
          <LogCard row={item} open={openId === item.id} onToggle={toggleRow} />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          padding: S.paddingContent,
          paddingBottom: insets.bottom + 40,
          flexGrow: 1,
        }}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={C.accent} />
        }
      />
    </View>
  );
}

const LogCard = memo(function LogCard({
  row,
  open,
  onToggle,
}: {
  row: LogRow;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  const tint = LEVEL_TINT[row.level] ?? LEVEL_TINT.info;
  return (
    <Pressable
      onPress={() => onToggle(row.id)}
      style={[s.card, ELEVATION_CARD, { borderLeftColor: tint.bar }]}
    >
      {/* Head row: level + tag + time */}
      <View style={s.cardHead}>
        <View style={[s.levelBadge, { backgroundColor: tint.soft }]}>
          <View style={[s.levelDot, { backgroundColor: tint.dot }]} />
          <Text style={[s.levelText, { color: tint.text }]}>{row.level}</Text>
        </View>
        <Text style={s.tagText}>{row.tag}</Text>
        <Text style={s.timeText}>{when(row.created_at)}</Text>
      </View>

      {/* Message */}
      <Text style={s.msgText} numberOfLines={open ? 999 : 2}>{row.message}</Text>

      {/* Meta row */}
      <View style={s.metaRow}>
        {row.email ? (
          <View style={[s.metaChip, { backgroundColor: C.accentSoft }]}>
            <Ionicons name="person-circle-outline" size={11} color={C.accent} />
            <Text style={s.emailText} numberOfLines={1}>{row.email}</Text>
          </View>
        ) : null}
        {row.device ? (
          <View style={[s.metaChip, { backgroundColor: C.surfaceGlass }]}>
            <Text style={s.deviceText} numberOfLines={1}>{row.device} · {row.platform}</Text>
          </View>
        ) : null}
        {row.app_version ? (
          <View style={[s.metaChip, { backgroundColor: C.surfaceGlass }]}>
            <Text style={s.verText}>v{row.app_version}</Text>
          </View>
        ) : null}
      </View>

      {/* Expanded context */}
      {open && row.context ? (
        <View style={[s.contextBox, { backgroundColor: tint.soft }]}>
          {Object.entries(row.context).map(([k, v]) => (
            <View key={k} style={s.contextRow}>
              <Text style={s.contextKey}>{k}</Text>
              <Text style={s.contextVal} numberOfLines={4}>
                {typeof v === "object" ? JSON.stringify(v) : String(v)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
});

function SummaryPill({ icon, count, label, tint }: {
  icon: keyof typeof Ionicons.glyphMap;
  count: number;
  label: string;
  tint: string;
}) {
  return (
    <View style={s.pill}>
      <View style={[s.pillIcon, { backgroundColor: tint + "22" }]}>
        <Ionicons name={icon as any} size={13} color={tint} />
      </View>
      <Text style={[s.pillNum, { color: tint }]}>{count}</Text>
      <Text style={s.pillLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  summary: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: R.xl, paddingVertical: 14, paddingHorizontal: 16,
    marginBottom: 16, position: "relative", overflow: "hidden",
    backgroundColor: C.surfaceCard, borderWidth: 1, borderColor: C.border,
    height: 64,
  },
  pill: { flexDirection: "row", alignItems: "center", gap: 6 },
  pillIcon: {
    width: 24, height: 24, borderRadius: R.circle,
    alignItems: "center", justifyContent: "center",
  },
  pillNum: { fontSize: 18, fontWeight: "900", fontFamily: "Outfit_800ExtraBold" },
  pillLabel: { color: C.textSecondary, fontSize: 11, fontFamily: "Outfit_600SemiBold" },
  healthy: {
    marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: R.pill,
    backgroundColor: C.successSoft,
  },
  healthyText: { color: C.success, fontSize: 11, fontWeight: "700", fontFamily: "Outfit_700Bold" },

  chips: { flexDirection: "row", gap: 8, marginBottom: 16 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.pill,
    backgroundColor: C.surfaceCard, borderWidth: 1, borderColor: C.border,
  },
  chipActive: { backgroundColor: C.accentSoft, borderColor: C.accent },
  chipText: {
    color: C.textSecondary, fontSize: 13, fontWeight: "600",
    fontFamily: "Outfit_600SemiBold",
  },
  chipTextActive: { color: C.accent },
  chipCount: {
    color: C.textFaint, fontSize: 11, fontWeight: "700",
    fontFamily: "Outfit_700Bold", minWidth: 18, textAlign: "center",
  },
  chipCountActive: { color: C.accent },

  center: { alignItems: "center", paddingTop: 72 },
  emptyIcon: {
    width: 68, height: 68, borderRadius: R.circle,
    backgroundColor: C.mintSoft, alignItems: "center", justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    color: C.text, fontSize: 17, fontWeight: "700",
    fontFamily: "Outfit_700Bold", marginBottom: 6,
  },
  emptySub: {
    color: C.textSecondary, fontSize: 13, textAlign: "center",
    fontFamily: "Outfit_500Medium", paddingHorizontal: 32, lineHeight: 20,
  },

  card: {
    backgroundColor: C.surfaceCard, borderRadius: R.lg,
    borderWidth: 1, borderColor: C.border, borderLeftWidth: 3,
    padding: 14, marginBottom: 10,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  levelBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill,
  },
  levelDot: { width: 7, height: 7, borderRadius: R.circle },
  levelText: {
    fontSize: 10, fontWeight: "800", letterSpacing: 0.5,
    fontFamily: "Outfit_800ExtraBold", textTransform: "uppercase",
  },
  tagText: {
    color: C.textSecondary, fontSize: 11, fontWeight: "600",
    fontFamily: "Outfit_600SemiBold",
    backgroundColor: C.inkHigh, paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: R.pill, overflow: "hidden",
  },
  timeText: {
    color: C.textFaint, fontSize: 11, marginLeft: "auto",
    fontFamily: "Outfit_500Medium",
  },
  msgText: {
    color: C.textSoft, fontSize: 14, lineHeight: 21,
    fontFamily: "Outfit_500Medium", marginBottom: 10,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  metaChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill,
  },
  emailText: {
    color: C.accent, fontSize: 11, fontWeight: "600",
    fontFamily: "Outfit_600SemiBold", maxWidth: 160,
  },
  deviceText: {
    color: C.textSecondary, fontSize: 11,
    fontFamily: "Outfit_500Medium",
  },
  verText: {
    color: C.textSecondary, fontSize: 11,
    fontFamily: "Outfit_500Medium",
  },
  contextBox: {
    marginTop: 10, padding: 12, borderRadius: R.md, gap: 5,
  },
  contextRow: { flexDirection: "row", gap: 8 },
  contextKey: {
    fontSize: 11, fontWeight: "700", minWidth: 75,
    fontFamily: "Outfit_700Bold",
  },
  contextVal: {
    color: C.textSoft, fontSize: 11, flex: 1,
    fontFamily: "Outfit_500Medium",
  },
});
