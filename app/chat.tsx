import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../lib/auth";
import {
  fetchMyThread,
  fetchChatMessages,
  sendChatMessage,
  sendChatPhoto,
  isPhotoBody,
  photoUrlFromBody,
  subscribeChatMessages,
  subscribeChatStatus,
  type Chat,
  type ChatMessage,
  type ChatStatus,
} from "../lib/adminChat";
import { C, S, R, ELEVATION_GLOW } from "../lib/theme";
import { t } from "../lib/i18n";
import { Aurora, ScreenHeader } from "../components/ScreenChrome";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { user, ready } = useAuth();
  const scrollRef = useRef<ScrollView>(null);

  const [thread, setThread] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingPhoto, setSendingPhoto] = useState(false);

  // Bootstrap: pull "my thread" (the chat admin opened with this user, or the
  // last thread admin closed so they can read history). When admin opens a
  // NEW thread while the user is on this screen, the realtime subscription
  // fires chat_my_thread again so the composer un-disables.
  const load = useCallback(async () => {
    const th = await fetchMyThread();
    setThread(th);
    if (th) {
      const msgs = await fetchChatMessages(th.id);
      setMessages(msgs);
    } else {
      setMessages([]);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  // Realtime on the current thread (if any).
  useEffect(() => {
    if (!thread) return;
    const unsubMsgs = subscribeChatMessages(thread.id, (m) => {
      setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    });
    const unsubStatus = subscribeChatStatus(thread.id, (status, closedAt) => {
      setThread((prev) => (prev ? { ...prev, status, closedAt } : prev));
    });
    return () => { unsubMsgs(); unsubStatus(); };
  }, [thread?.id]);

  // Pin to bottom on new content so the freshest bubble is in view.
  useEffect(() => {
    if (!loaded) return;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length, loaded]);

  const closed = thread?.status === "closed";

  const onSend = useCallback(async () => {
    if (sending || closed || !thread || !draft.trim()) return;
    setSending(true);
    const body = draft;
    setDraft("");
    const msg = await sendChatMessage(thread.id, body);
    setSending(false);
    if (!msg) {
      setDraft(body);
      Alert.alert(t.chatFailedToSend);
      return;
    }
    setMessages((prev) => (prev.some((p) => p.id === msg.id) ? prev : [...prev, msg]));
  }, [sending, closed, thread, draft]);

  // Pick a photo from the gallery, upload, and send as `img:<url>`.
  const onAttachPhoto = useCallback(async () => {
    if (sendingPhoto || closed || !thread || !user) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t.chatAttachPhoto, t.reportPhotoPermission);
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
    });
    if (res.canceled || !res.assets?.length) return;
    const b64 = res.assets[0].base64;
    if (!b64) return;
    setSendingPhoto(true);
    const msg = await sendChatPhoto(thread.id, b64, user.id);
    setSendingPhoto(false);
    if (!msg) {
      Alert.alert(t.chatPhotoFailed);
      return;
    }
    setMessages((prev) => (prev.some((p) => p.id === msg.id) ? prev : [...prev, msg]));
  }, [sendingPhoto, closed, thread, user]);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.chatUserThreadTitle} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 56 : 0}
      >
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: S.paddingContent, paddingBottom: 24, flexGrow: 1 }}
        >
          {!loaded ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator size="large" color={C.accent} />
            </View>
          ) : !thread ? (
            <View style={s.emptyWrap}>
              <View style={s.emptyIcon}>
                <Ionicons name="chatbubble-ellipses-outline" size={30} color={C.textMuted} />
              </View>
              <Text style={s.emptyTitle}>{t.chatNoThreadTitle}</Text>
              <Text style={s.emptySub}>{t.chatNoThreadSub}</Text>
            </View>
          ) : (
            <View style={s.bubbleList}>
              {messages.length === 0 ? (
                <View style={s.emptyWrap}>
                  <View style={s.emptyIcon}>
                    <Ionicons name="chatbubble-ellipses-outline" size={28} color={C.textMuted} />
                  </View>
                  <Text style={s.emptyTitle}>{t.chatNoMessages}</Text>
                  <Text style={s.emptySub}>{t.chatNoMessagesSub}</Text>
                </View>
              ) : (
                messages.map((m, i) => {
                  const mine = m.senderId === user?.id;
                  const prev = messages[i - 1];
                  const stacked = prev && prev.senderId === m.senderId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 60_000;
                  const photo = isPhotoBody(m.body);
                  return (
                    <View key={m.id} style={[s.bubbleRow, stacked && s.bubbleStacked]}>
                      <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs, photo && s.bubblePhoto]}>
                        {photo ? (
                          <Image
                            source={{ uri: photoUrlFromBody(m.body) }}
                            style={s.bubbleImage}
                            contentFit="cover"
                            transition={180}
                          />
                        ) : (
                          <Text style={[s.bubbleBody, mine ? s.bubbleBodyMine : s.bubbleBodyTheirs]}>{m.body}</Text>
                        )}
                      </View>
                      {stacked ? null : <Text style={[s.bubbleTime, mine && s.bubbleTimeMine]}>{timeLabel(m.createdAt)}</Text>}
                    </View>
                  );
                })
              )}
              {closed ? (
                <View style={s.closedBanner}>
                  <Ionicons name="lock-closed-outline" size={14} color={C.textMuted} />
                  <Text style={s.closedBannerText}>{t.chatClosedByAdmin}</Text>
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>

        {/* Composer — disabled when there's no thread OR thread is closed. */}
        {loaded && thread ? (
          <View style={[s.composer, { paddingBottom: insets.bottom + 8 }]}>
            <TextInput
              style={[s.input, closed && s.inputDisabled]}
              value={draft}
              onChangeText={setDraft}
              placeholder={closed ? t.chatReplyDisabled : t.chatPlaceholder}
              placeholderTextColor={C.textMuted}
              multiline
              editable={!closed && !sending && !sendingPhoto}
              textAlign="right"
              textAlignVertical="center"
            />
            <Pressable
              onPress={onAttachPhoto}
              disabled={closed || sendingPhoto || sending}
              hitSlop={8}
              accessibilityLabel={t.chatAttachPhoto}
              style={({ pressed }) => [
                s.attachBtn,
                pressed && s.attachBtnPressed,
                (closed || sendingPhoto || sending) && s.attachBtnDisabled,
              ]}
            >
              {sendingPhoto ? (
                <ActivityIndicator size="small" color={C.accent} />
              ) : (
                <Ionicons name="camera-outline" size={22} color={C.accent} />
              )}
            </Pressable>
            <Pressable
              onPress={onSend}
              disabled={closed || sending || sendingPhoto || !draft.trim()}
              style={({ pressed }) => [
                s.sendBtn,
                pressed && s.sendBtnPressed,
                (closed || sending || sendingPhoto || !draft.trim()) && s.sendBtnDisabled,
              ]}
            >
              {sending ? (
                <ActivityIndicator size="small" color={C.textOnAccent} />
              ) : (
                <Ionicons name="send" size={22} color={C.textOnAccent} />
              )}
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  loadingWrap: { paddingVertical: 60, alignItems: "center" },

  bubbleList: { gap: 6 },
  bubbleRow: { alignItems: "flex-start", maxWidth: "100%" },
  bubbleStacked: { marginTop: 2 },

  bubble: {
    borderRadius: R.lg,
    paddingHorizontal: 13, paddingVertical: 9,
    maxWidth: "82%",
  },
  bubbleMine: {
    alignSelf: "flex-end",
    backgroundColor: C.accent,
    borderBottomRightRadius: 5,
  },
  bubbleTheirs: {
    alignSelf: "flex-start",
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    borderBottomLeftRadius: 5,
  },
  bubblePhoto: {
    paddingHorizontal: 3, paddingVertical: 3,
    backgroundColor: "transparent",
    borderWidth: 0,
  },
  bubbleImage: {
    width: 220, height: 220, borderRadius: Math.max(R.lg - 3, 10),
  },
  bubbleBody: { fontSize: 14.5, lineHeight: 20, fontFamily: "Cairo_500Medium", textAlign: "right" },
  bubbleBodyMine: { color: C.textOnAccent, fontWeight: "600" },
  bubbleBodyTheirs: { color: C.text },
  bubbleTime: { color: C.textFaint, fontSize: 10, marginTop: 3, fontFamily: "Cairo_500Medium", alignSelf: "flex-start" },
  bubbleTimeMine: { alignSelf: "flex-end" },

  closedBanner: {
    flexDirection: "row-reverse", alignItems: "center", gap: 6,
    alignSelf: "center", marginTop: 20,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  closedBannerText: { color: C.textMuted, fontSize: 11.5, fontFamily: "Cairo_600SemiBold" },

  emptyWrap: { alignItems: "center", paddingVertical: 56, marginTop: 24 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: R.circle, marginBottom: 14,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "700", fontFamily: "Cairo_700Bold" },
  emptySub: { color: C.textMuted, fontSize: 13, marginTop: 6, textAlign: "center", fontFamily: "Cairo_500Medium", lineHeight: 19 },

  composer: {
    flexDirection: "row-reverse", alignItems: "flex-end",
    paddingHorizontal: S.paddingContent, paddingTop: 10,
    backgroundColor: C.bg,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  input: {
    flex: 1, minHeight: 44, maxHeight: 120,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: R.xl, marginRight: 10,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    color: C.text, fontSize: 14, lineHeight: 20, fontFamily: "Cairo_500Medium",
  },
  inputDisabled: { borderColor: "rgba(255,255,255,0.06)", backgroundColor: C.surfaceLight },
  attachBtn: {
    width: 44, height: 44, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
    marginRight: 8,
  },
  attachBtnPressed: { transform: [{ scale: 0.94 }], opacity: 0.7 },
  attachBtnDisabled: { opacity: 0.35 },
  sendBtn: {
    width: 48, height: 48, borderRadius: R.circle,
    backgroundColor: C.accent, alignItems: "center", justifyContent: "center",
    ...ELEVATION_GLOW,
  },
  sendBtnPressed: { transform: [{ scale: 0.94 }] },
  sendBtnDisabled: { opacity: 0.55, backgroundColor: C.accentMuted },
});