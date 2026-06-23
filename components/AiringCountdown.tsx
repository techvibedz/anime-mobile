// Live "next episode in …" countdown for the anime detail header.
//
// Fetches the next airing time once (AniList, cached — see lib/airing) and then
// ticks locally every second, so it paints the moment the page's data arrives
// and never re-hits the network. Renders nothing for finished/non-airing anime,
// so it's safe to drop in unconditionally without reserving layout.

import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, AppState } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fetchNextAiring, type NextAiring } from "../lib/airing";
import { C, R } from "../lib/theme";
import { t } from "../lib/i18n";

function parts(msLeft: number) {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    mins: Math.floor((s % 3600) / 60),
    secs: s % 60,
  };
}

export function AiringCountdown({ title }: { title: string | null | undefined }) {
  const [info, setInfo] = useState<NextAiring | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Resolve the next airing episode for this title.
  useEffect(() => {
    if (!title) { setInfo(null); return; }
    let cancelled = false;
    fetchNextAiring(title).then((n) => { if (!cancelled) setInfo(n); });
    return () => { cancelled = true; };
  }, [title]);

  // Tick every second while we have an upcoming episode. Stops once it airs so
  // we don't keep a needless interval alive in the background.
  //
  // Battery: a 1s interval that keeps firing while the app is backgrounded (or
  // sitting in the recents list) wakes the JS thread every second for a digit
  // nobody can see. Run the interval ONLY while the app is foregrounded — pause
  // it on background and resync on resume (a single setNow snaps the digits back
  // to the correct value instantly).
  useEffect(() => {
    if (!info) return;
    const target = info.airingAt * 1000;
    const tick = () => setNow(Date.now());

    const start = () => {
      if (timer.current || Date.now() >= target) return;
      tick();
      timer.current = setInterval(() => {
        if (Date.now() >= target && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
        tick();
      }, 1000);
    };
    const stop = () => {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
    };

    if (AppState.currentState === "active") start();
    else tick();

    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") { tick(); start(); }
      else stop();
    });
    return () => { stop(); sub.remove(); };
  }, [info]);

  if (!info) return null;

  const msLeft = info.airingAt * 1000 - now;

  if (msLeft <= 0) {
    return (
      <View style={[styles.card, styles.liveCard]}>
        <View style={styles.liveDot} />
        <Text style={styles.liveText}>{t.airingNow(info.episode)}</Text>
      </View>
    );
  }

  const { days, hours, mins, secs } = parts(msLeft);
  const segs = [
    ...(days > 0 ? [{ value: days, unit: t.cdDays }] : []),
    { value: hours, unit: t.cdHours },
    { value: mins, unit: t.cdMins },
    ...(days === 0 ? [{ value: secs, unit: t.cdSecs }] : []),
  ];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="time-outline" size={14} color={C.violet} />
        <Text style={styles.label}>{t.nextEpIn(info.episode)}</Text>
      </View>
      <View style={styles.segs}>
        {segs.map((s, i) => (
          <View key={i} style={styles.seg}>
            <Text style={styles.segValue}>{String(s.value).padStart(2, "0")}</Text>
            <Text style={styles.segUnit}>{s.unit}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: R.lg,
    backgroundColor: C.violetSoft,
    borderWidth: 1,
    borderColor: C.borderViolet,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 5 },
  label: {
    color: C.violet, fontSize: 12, fontWeight: "700",
    fontFamily: "Cairo_600SemiBold",
  },
  segs: { flexDirection: "row", gap: 6 },
  seg: {
    minWidth: 34, alignItems: "center",
    paddingHorizontal: 6, paddingVertical: 4,
    borderRadius: R.sm, backgroundColor: "rgba(255,122,79,0.18)",
  },
  segValue: {
    color: C.text, fontSize: 15, fontWeight: "800",
    fontFamily: "Outfit_700Bold", fontVariant: ["tabular-nums"],
  },
  segUnit: {
    color: C.textSecondary, fontSize: 9, fontWeight: "600",
    marginTop: 1, fontFamily: "Cairo_500Medium",
  },

  liveCard: {
    backgroundColor: C.accentSoft, borderColor: C.borderAccent,
    paddingVertical: 11,
  },
  liveDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent,
  },
  liveText: {
    color: C.accent, fontSize: 13, fontWeight: "700",
    fontFamily: "Cairo_600SemiBold",
  },
});
