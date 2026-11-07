// Shared-moment deep link: anime-mobile://moment/<id> (from the web share
// page). Loads the moment and opens the player at its timestamp.

import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth";
import { fetchMoment, isMomentId, setPendingMoment } from "../../lib/moments";
import { C, R } from "../../lib/theme";
import { t } from "../../lib/i18n";

export default function MomentScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user, ready } = useAuth();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isMomentId(id)) {
      setFailed(true);
      return;
    }
    // Signed out: AuthGate sends the user to sign in; come back here after.
    if (ready && !user) {
      setPendingMoment(id);
      return;
    }
    if (!ready) return;
    let alive = true;
    void fetchMoment(id).then((m) => {
      if (!alive) return;
      if (!m) {
        setFailed(true);
        return;
      }
      router.replace({
        pathname: `/watch/${encodeURIComponent(m.episode_href)}`,
        params: {
          anime: m.anime_href || "",
          animeTitle: m.anime_title,
          img: m.image || "",
          epNum: m.ep_num != null ? String(m.ep_num) : "",
          url4up: m.url4up || "",
          url3rb: m.url3rb || "",
          t: String(m.t_sec),
          from: m.sharer_name || "",
        },
      });
    });
    return () => { alive = false; };
  }, [id, user, ready]);

  return (
    <View style={ss.root}>
      {failed ? (
        <>
          <Ionicons name="link-outline" size={40} color={C.textMuted} />
          <Text style={ss.text}>{t.momentNotFound}</Text>
          <Pressable onPress={() => router.replace("/(tabs)")} style={ss.btn}>
            <Text style={ss.btnText}>{t.goBack}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={ss.text}>{t.momentOpening}</Text>
        </>
      )}
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  text: { color: C.textSecondary, fontSize: 14, fontFamily: "Cairo_600SemiBold", marginTop: 14, textAlign: "center" },
  btn: { marginTop: 18, paddingHorizontal: 20, paddingVertical: 12, borderRadius: R.lg, backgroundColor: C.accent },
  btnText: { color: C.textOnAccent, fontSize: 14, fontFamily: "Cairo_700Bold" },
});
