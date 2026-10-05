import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  TextInput,
  StyleSheet,
  StatusBar,
  PanResponder,
  Dimensions,
  Animated,
  Easing,
} from "react-native";
import { VideoView, useVideoPlayer, isPictureInPictureSupported } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ScreenOrientation from "expo-screen-orientation";
import { Ionicons } from "@expo/vector-icons";
import { fetchCompleteVideoServers, resolveVideo, prefetchAnime3rbServers } from "../../lib/api";
import type { VideoServer, Episode } from "../../lib/api";
import type { MediaSubtitle } from "../../lib/scraper/direct";
import {
  NEXT_EPISODE_COUNTDOWN_SECONDS,
  cycleSubtitleTrack,
  nextSleepPreset,
  sleepMinutesLeft,
} from "../../lib/playerExtras";
import { askCompanion } from "../../lib/companion";
import { prefetchNextEpisode, stopPrefetch } from "../../lib/prefetch";
import { seasonNum, slugToTitle } from "../../lib/relations";
import { saveProgress, getProgress } from "../../lib/history";
import { recordEpisodeWatched } from "../../lib/completion";
import { getDownloadByEpisode, subscribeDownloads, type DownloadStatus, type DownloadMeta } from "../../lib/downloads";
import { DownloadPicker } from "../../components/DownloadPicker";
import { getAutoplayNext, getAutoSkipIntro } from "../../lib/settings";
import { getEpisodeSkipTimes, activeSkipInterval, type EpisodeSkipTimes, type ActiveSkip } from "../../lib/aniskip";
import { maybeShowInterstitial } from "../../lib/ads";
import { useAuth } from "../../lib/auth";
import { useWatchPartySync, createRoom } from "../../lib/watchParty";
import { C, R, ABSOLUTE_FILL } from "../../lib/theme";
import { t } from "../../lib/i18n";
import { useReducedMotion } from "../../lib/motion";
import {
  bufferAheadSeconds,
  createGenerationGuard,
  episodeNumberFromUrl,
  providerFailureMode,
  providerRank,
  providerSupportsAdaptivePlayback,
  qualityScore,
  sortVideoServers,
  videoContentType,
  videoPlaybackHeaders,
} from "../../lib/videoProviders";
import { _cancelBackground } from "../../lib/scraper/bus";
import { cueAt, parseVtt, type SubtitleCue } from "../../lib/subtitles";
import { remoteLog } from "../../lib/remoteLog";

type ServerStatus = "idle" | "resolving" | "playing" | "webview" | "failed";

interface ServerState {
  server: VideoServer & { source?: string };
  status: ServerStatus;
  videoUrl: string | null;
  /** Sidecar subtitle tracks for providers that ship a separate VTT. */
  subtitles?: MediaSubtitle[];
}

const localServer = (videoUrl: string): ServerState => ({
  server: { id: "local", name: t.downloaded, iframeUrl: "", provider: "local", source: "local" },
  status: "playing",
  videoUrl,
});

// Where a server should land when direct resolution is exhausted.
const failStatus = (provider?: string): ServerStatus =>
  providerFailureMode(provider) as ServerStatus;

const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];

function safeHost(raw: string): string | null {
  try { return new URL(raw).hostname.toLowerCase(); } catch { return null; }
}

// Short quality tag for the server-selection list ("" when unknown).
function qualityLabel(name: string): string {
  switch (qualityScore(name)) {
    case 3: return "FHD";
    case 2: return "HD";
    case 0: return "SD";
    default: return "";
  }
}

function getDisplayName(server: VideoServer): string {
  const name = (server.name || "").trim();
  const provider = server.provider || "generic";
  if (!name || /^(server\s*\d*|4up\s*s\d*)$/i.test(name)) {
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
  return name;
}

function getIframeUrl(server: VideoServer | undefined): string {
  if (!server) return "";
  const raw = (server.iframeUrl || "").trim();
  return raw.startsWith("//") ? `https:${raw}` : raw;
}

// Hard black border around cue text. RN has no text-stroke, so eight black
// copies of the cue are painted under the white glyphs, offset 1.5px each way.
const SUBTITLE_OUTLINE: [number, number][] = [
  [-1.5, -1.5], [0, -1.5], [1.5, -1.5],
  [-1.5, 0], [1.5, 0],
  [-1.5, 1.5], [0, 1.5], [1.5, 1.5],
];

// Sidecar subtitles. Anime4up's CDN ships the Arabic track as a separate .vtt
// (its HLS master carries no subtitle rendition) and expo-video has no API for
// external tracks, so the VTT is parsed once and the active cue is painted over
// the video, synced to the player clock.
function SubtitleOverlay({
  tracks,
  selected,
  player,
  playing,
}: {
  tracks?: MediaSubtitle[];
  /** Index into `tracks`; -1/undefined = subtitles off. */
  selected?: number;
  player: ReturnType<typeof useVideoPlayer> | null;
  playing: boolean;
}) {
  const [cues, setCues] = useState<SubtitleCue[] | null>(null);
  const [text, setText] = useState<string | null>(null);
  const trackUrl = selected != null && selected >= 0 ? tracks?.[selected]?.url || "" : "";

  useEffect(() => {
    if (!trackUrl) { setCues(null); setText(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(trackUrl, { headers: { Accept: "text/vtt, */*" } });
        if (!res.ok) return;
        const raw = await res.text();
        if (!cancelled) setCues(parseVtt(raw));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [trackUrl]);

  useEffect(() => {
    if (!cues || cues.length === 0 || !player || !playing) { setText(null); return; }
    const tick = () => {
      let time = 0;
      try { time = player.currentTime || 0; } catch {}
      const next = cueAt(cues, time);
      setText((prev) => (prev === next ? prev : next));
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [cues, player, playing]);

  if (!text) return null;
  const rtl = /[\u0600-\u06ff]/.test(text);
  const base = [ss.subtitleText, rtl && ss.subtitleTextRtl];
  return (
    <View pointerEvents="none" style={ss.subtitleWrap}>
      <View style={ss.subtitleBox}>
        {SUBTITLE_OUTLINE.map(([dx, dy]) => (
          <Text
            key={`${dx},${dy}`}
            accessible={false}
            style={[...base, ss.subtitleOutline, { transform: [{ translateX: dx }, { translateY: dy }] }]}
          >
            {text}
          </Text>
        ))}
        <Text style={base}>{text}</Text>
      </View>
    </View>
  );
}

const ADBLOCK_JS = `(function(){
  window.open=function(){return null};
  window.alert=function(){};
  var embedURL=location.href;
  // Block all programmatic redirects unless to embed domain
  var _assign=location.assign.bind(location);
  var _replace=location.replace.bind(location);
  var _setHref=Object.getOwnPropertyDescriptor(Location.prototype,'href');
  location.assign=function(u){
    if(typeof u==='string'&&u.startsWith('http')&&!u.includes(new URL(embedURL).hostname))return;
    _assign(u);
  };
  location.replace=function(u){
    if(typeof u==='string'&&u.startsWith('http')&&!u.includes(new URL(embedURL).hostname))return;
    _replace(u);
  };
  if(_setHref&&_setHref.set){
    Object.defineProperty(location,'href',{
      get:_setHref.get,
      set:function(u){
        if(typeof u==='string'&&u.startsWith('http')&&!u.includes(new URL(embedURL).hostname))return;
        _setHref.set.call(location,u);
      }
    });
  }
  function nuke(){
    try{
      document.querySelectorAll('[class*="ad-"],[id*="ad-"],[class*="popup"],[class*="popunder"],iframe[src*="pyppo"],iframe[src*="popads"],a[href*="intent://"]').forEach(function(el){el.remove()});
      document.querySelectorAll('div').forEach(function(el){
        var s=window.getComputedStyle(el);
        if(s.position==='fixed'&&parseInt(s.zIndex)>9999&&(el.textContent||'').length<30)el.remove();
      });
    }catch(e){}
  }
  nuke();setInterval(nuke,2000);
  // Block popunders triggered by cross-origin target="_blank" anchor clicks.
  document.addEventListener('click',function(e){
    try{
      var a=e.target&&e.target.closest&&e.target.closest('a[target="_blank"]');
      if(!a||!a.href)return;
      if(new URL(a.href).hostname!==location.hostname){e.preventDefault();e.stopPropagation();}
    }catch(e2){}
  },true);
})();true;`;

const PROGRESS_JS = `
(function(){
  function readDoc(doc){
    var pos=0,dur=0;
    try {
      // Standard video element
      var v=doc.querySelector('video');
      if(v&&v.duration>0){pos=v.currentTime*1000;dur=v.duration*1000;}
      var w=doc.defaultView;
      // JW Player
      if(!pos&&w&&typeof w.jwplayer==='function'){
        try{var p=w.jwplayer();if(p&&p.getPosition&&p.getDuration){pos=p.getPosition()*1000;dur=p.getDuration()*1000;}}catch(e){}
      }
      // VideoJS
      if(!pos&&w&&typeof w.videojs==='function'){
        try{var vj=w.videojs(doc.querySelector('.video-js'));if(vj&&vj.currentTime&&vj.duration){pos=vj.currentTime()*1000;dur=vj.duration()*1000;}}catch(e){}
      }
    }catch(e){}
    return {pos:pos,dur:dur};
  }
  function read(){
    var r=readDoc(document);
    // Many embeds host their player in a nested iframe. Same-origin frames are
    // reachable (cross-origin ones throw and are skipped) — without this, those
    // servers never reported a position and never reached Continue Watching.
    if(!r.pos){
      try{
        var frames=document.querySelectorAll('iframe');
        for(var i=0;i<frames.length&&!r.pos;i++){
          var cd=null;
          try{cd=frames[i].contentDocument;}catch(e){cd=null;}
          if(cd) r=readDoc(cd);
        }
      }catch(e){}
    }
    return r;
  }
  setInterval(function(){
    var r=read();
    if(r.pos>0&&r.dur>0){
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'progress',pos:Math.round(r.pos),dur:Math.round(r.dur)}));
    }
  },3000);
})();
true;
`;

function webViewResumeScript(positionMs: number): string {
  const target = Math.max(0, Math.round(positionMs)) / 1000;
  if (target <= 0) return "";
  return `
  (function(){
    var target=${target};
    var attempts=0;
    var timer=setInterval(function(){
      attempts++;
      var sought=false;
      try{
        var v=document.querySelector('video');
        if(v&&isFinite(v.duration)&&v.duration>0){v.currentTime=Math.min(target,Math.max(0,v.duration-1));sought=true;}
        if(!sought&&typeof jwplayer==='function'){
          try{var p=jwplayer();if(p&&p.seek&&p.getDuration&&p.getDuration()>0){p.seek(Math.min(target,Math.max(0,p.getDuration()-1)));sought=true;}}catch(e){}
        }
        if(!sought&&typeof videojs==='function'){
          try{var vj=videojs(document.querySelector('.video-js'));if(vj&&vj.currentTime&&vj.duration&&vj.duration()>0){vj.currentTime(Math.min(target,Math.max(0,vj.duration()-1)));sought=true;}}catch(e){}
        }
      }catch(e){}
      if(sought||attempts>=40)clearInterval(timer);
    },500);
  })();
  true;`;
}

export default function WatchScreen() {
  const { episode, url4up, url3rb, epNum: epNumParam, animeTitle: animeTitleParam, img: imgParam, nextEp: nextEpParam, prevEp: prevEpParam, anime: animeParam, local: localParam, auto: autoParam } = useLocalSearchParams<{
    episode: string; url4up?: string; url3rb?: string; epNum?: string; animeTitle?: string; img?: string; nextEp?: string; prevEp?: string; anime?: string; local?: string; auto?: string;
  }>();
  const insets = useSafeAreaInsets();

  // Offline playback: when `local` is a downloaded file:// URI, the whole
  // scraping/enrichment pipeline is bypassed — we just play the local file.
  const localUri = localParam ? decodeURIComponent(localParam) : null;

  // Episode number passed explicitly from the detail page (works for any
  // source's URL shape, unlike the الحلقة-N regex which only matches
  // witanime/anime4up URLs). The enrichment effects prefer this.
  const paramEpNum = epNumParam && /^\d+$/.test(epNumParam) ? parseInt(epNumParam, 10) : null;

  const [loading, setLoading] = useState(!localUri);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [animeTitle, setAnimeTitle] = useState("");
  const [animeHref, setAnimeHref] = useState("");
  const [nextEpisodeHref, setNextEpisodeHref] = useState<string | null>(null);
  const [prevEpisodeHref, setPrevEpisodeHref] = useState<string | null>(null);
  const [servers, setServers] = useState<ServerState[]>(() => localUri ? [localServer(localUri)] : []);
  const [activeIdx, setActiveIdx] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Server-selection gate. On a fresh tap from the episode list/home/history we
  // show a server-picker layout FIRST and only start resolving/playing once the
  // user picks one. Auto-play hops (next/prev/autoplay carry auto="1") and
  // offline files skip the gate and play immediately.
  const [picked, setPicked] = useState(!!autoParam || !!localParam);
  // Live mirror of `picked` for the focus effect (so it can pick the right
  // orientation on re-focus without re-subscribing — which would re-run its
  // player.pause() cleanup).
  const pickedRef = useRef(!!autoParam || !!localParam);
  useEffect(() => { pickedRef.current = picked; }, [picked]);
  const [refreshing, setRefreshing] = useState(false);
  // The fallback sources were also exhausted with nothing — only then do we
  // surface the "no servers" error instead of the still-searching spinner.
  const [noServersFinal, setNoServersFinal] = useState(false);
  // Live mirror of `servers` readable from settled async handlers / timers.
  const serversRef = useRef<ServerState[]>([]);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [resumeMs, setResumeMs] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Self-heal bookkeeping: re-resolve attempts per server index, and a
  // position (ms) to seek to once the re-resolved source starts playing.
  const retryCountRef = useRef<Record<number, number>>({});
  const pendingSeekRef = useRef(0);
  // Live position survives source teardown, including native-to-WebView
  // fallbacks where the old player can disappear before the new one is ready.
  const playbackPositionMsRef = useRef(0);
  const [serverStartPositionMs, setServerStartPositionMs] = useState(0);
  // Autoplay-next bookkeeping (gated by the Settings preference). goNextRef is
  // filled in after goNextEpisode is defined; autoAdvancedRef de-dupes the
  // single advance per episode once playback crosses the near-end threshold.
  const autoplayRef = useRef(true);
  const goNextRef = useRef<() => void>(() => {});
  const autoAdvancedRef = useRef(false);
  // Watch Party: when this device is a CLIENT, the host drives playback —
  // local controls (toggle/seek/skip/next/auto-advance) are suppressed and the
  // sync hook applies the host's state instead. Read through a ref so the
  // callbacks/PanResponders defined before the hook can see the live role.
  const partyClientRef = useRef(false);
  // True only while this watch screen is the focused route. With freezeOnBlur the
  // screen stays MOUNTED when the user pushes the anime page on top of it — the
  // native player and its self-heal/auto-play timers keep running, which would
  // resurrect audio on the backgrounded episode. Every autonomous play() checks
  // this ref so a blurred screen can never restart playback. (User taps and the
  // party host's sync still play through their own paths.)
  const focusedRef = useRef(true);
  // Watch-party host gate: while true, the source resolving must NOT auto-play
  // (the room isn't ready yet). Mirrors party.holdPlayback through a ref so the
  // player-setup closure + effects can read it without re-subscribing.
  const holdPlaybackRef = useRef(false);
  // Host-only: broadcast the live player state the instant a control fires, so
  // viewers play/pause/seek in lock-step instead of waiting for the heartbeat.
  // Filled in after the party hook (these handlers are defined before it). No-op
  // off-host. Pass the post-action play state when toggling so the broadcast
  // isn't built from React's not-yet-updated paused flag.
  const partyPulseRef = useRef<(playing?: boolean) => void>(() => {});

  // Load the autoplay preference once; reset the per-episode guard on change.
  useEffect(() => {
    getAutoplayNext().then((v) => { autoplayRef.current = v; });
    getAutoSkipIntro().then((v) => { autoSkipIntroRef.current = v; });
  }, []);

  // AniSkip states & Auto-Skip preferences
  const [skipTimes, setSkipTimes] = useState<EpisodeSkipTimes | null>(null);
  const [activeSkip, setActiveSkip] = useState<ActiveSkip | null>(null);
  const autoSkipIntroRef = useRef(false);
  const skippedIntervalsRef = useRef<Set<string>>(new Set());

  // ── PLAYER EXTRAS (PiP · sleep timer · episode list · subtitles) ──
  // PiP + background playback need the expo-video config plugin baked into the
  // APK; isPictureInPictureSupported() is false on older binaries (OTA), so the
  // button hides itself there instead of failing.
  const videoViewRef = useRef<VideoView>(null);
  // On an OTA-updated app running on an older APK, the JS reports PiP as
  // supported (Android checks SDK/device feature) but the activity lacks the
  // manifest flag, so entering rejects — hide the button on first failure.
  const [pipSupported, setPipSupported] = useState(() => {
    try { return isPictureInPictureSupported(); } catch { return false; }
  });
  // Sleep timer: chosen preset in minutes (null = off), wall-clock deadline,
  // and a 30s-refreshed "minutes left" label for the chip.
  const [sleepPreset, setSleepPreset] = useState<number | null>(null);
  const [sleepEndsAt, setSleepEndsAt] = useState<number | null>(null);
  const [sleepMinutes, setSleepMinutes] = useState(0);
  // Subtitle track index (-1 = off). Reset whenever the active server changes.
  const [subtitleIdx, setSubtitleIdx] = useState(0);
  // Episode list panel state. The list is fetched lazily on first open and
  // cached per anime href for the rest of the watch session.
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [epList, setEpList] = useState<Episode[]>([]);
  const [epListLoading, setEpListLoading] = useState(false);
  const epListForRef = useRef<string | null>(null);
  const epFetchRef = useRef(0);
  // Next-episode countdown (seconds) shown before the auto-advance fires.
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  const nextEpRef = useRef<string | null>(null);
  // Silent prefetch: {title, epNum} derived by the a3rb effect, consumed by
  // the delayed byte-prefetch effect further down.
  const prefetchCtxRef = useRef<{ title: string; epNum: number } | null>(null);
  // رفيق الأنمي — spoiler-safe AI companion sheet.
  const [companionOpen, setCompanionOpen] = useState(false);
  const [companionMsgs, setCompanionMsgs] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [companionBusy, setCompanionBusy] = useState(false);
  const [companionInput, setCompanionInput] = useState("");
  const companionBusyRef = useRef(false); // synchronous double-tap guard
  const companionGenRef = useRef(0); // bumps per episode; drops stale replies
  // Episode number for the companion's spoiler bound: route param first, then
  // the same href fallbacks the prefetch effect uses.
  const companionEpNum = useMemo(() => {
    if (paramEpNum != null) return paramEpNum;
    if (!episode) return null;
    const href = decodeURIComponent(episode);
    const um = href.match(/الحلقة[\s\-_]*(\d+)/);
    if (um) return parseInt(um[1], 10);
    const am = href.match(/\/episode\/[^/]+\/(\d+)/);
    if (am) return parseInt(am[1], 10);
    return null;
  }, [paramEpNum, episode]);

  // HUD Toast feedback
  const [toastText, setToastText] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastText(msg);
    Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
        setToastText(null);
      });
    }, 2200);
  }, [toastOpacity]);
  // Once per episode: marks the completion badge when the LAST episode is
  // finished, so it doesn't wait for a detail-page revisit.
  const completionMarkedRef = useRef(false);
  useEffect(() => {
    autoAdvancedRef.current = false;
    completionMarkedRef.current = false;
    pendingSeekRef.current = 0;
    playbackPositionMsRef.current = 0;
    setResumeMs(0);
    setServerStartPositionMs(0);
    setLocked(false);
    setSelfReady(false); // re-buffer for the new episode → re-arm the party gate
    skippedIntervalsRef.current.clear();
    setActiveSkip(null);
    setSkipTimes(null);
    setNextCountdown(null);
    prefetchCtxRef.current = null;
    stopPrefetch();
    companionGenRef.current += 1; // drop any in-flight companion reply
    companionBusyRef.current = false; // never leave the send-guard stuck
    setCompanionMsgs([]);
    setCompanionOpen(false);
    setCompanionInput("");
    setCompanionBusy(false);
    // Re-arm the server-selection gate for the new episode, unless this is an
    // auto-play hop (next/prev/autoplay) or an offline file — those play directly.
    setPicked(!!autoParam || !!localParam);
  }, [episode]);

  // Fire auto-advance when playback nears the end (≥97%) and a next episode
  // exists. Shared by the native + WebView progress timers. Instead of hopping
  // instantly, a 10s countdown card appears (watch now / cancel).
  const maybeAutoAdvance = useCallback((pos: number, dur: number) => {
    if (partyClientRef.current) return; // host drives episode changes
    if (isPausedRef.current) return; // never auto-advance a paused screen
    if (!autoplayRef.current || autoAdvancedRef.current) return;
    if (dur > 0 && pos / dur >= 0.97 && nextEpRef.current) {
      autoAdvancedRef.current = true;
      setNextCountdown(NEXT_EPISODE_COUNTDOWN_SECONDS);
    }
  }, []);

  // Tick the next-episode countdown; zero navigates via the shared goNext ref.
  // Cancel/watch-now clear the state; autoAdvancedRef stays burned so the
  // progress timers can never re-arm it for this episode.
  useEffect(() => {
    if (nextCountdown == null) return;
    if (nextCountdown <= 0) {
      setNextCountdown(null);
      // A sleep timer (or manual pause) that landed during the countdown must
      // win — never start the next episode on a paused/asleep screen.
      if (!isPausedRef.current) goNextRef.current?.();
      return;
    }
    const timer = setTimeout(() => setNextCountdown((n) => (n == null ? null : n - 1)), 1000);
    return () => clearTimeout(timer);
  }, [nextCountdown]);

  // Mark the anime "caught up"/"finished" the moment this episode crosses the
  // 80% watched threshold — same bar history uses for "completed". The poster
  // badge flips immediately instead of waiting for the detail page. The episode
  // number falls back to the href via episodeNumberFromUrl (parses "الحلقة-N"
  // AND /episode|watch/<slug>/<N> — witanime episode URLs are /watch/<slug>/N,
  // which the old inline regex missed), and the once-per-episode flag only
  // burns once a number is in hand — a failed derive must not disable recording
  // for the rest of the episode.
  const maybeMarkCompleted = useCallback((pos: number, dur: number) => {
    if (completionMarkedRef.current) return;
    if (dur <= 0 || pos / dur < 0.8) return;
    let epNum: number | null = paramEpNum;
    if (epNum == null && episode) epNum = episodeNumberFromUrl(episode);
    if (epNum == null) return; // retry on the next tick (e.g. after the scrape lands)
    completionMarkedRef.current = true;
    const dec = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };
    const aTitle = (animeTitleParam ? dec(animeTitleParam) : "") || animeTitle;
    const aHref = animeHref || (animeParam ? dec(animeParam) : "");
    // The detail grid passes nextEp="" for the last episode — that lets the
    // player establish a missing completion record (badge) on the finale even
    // when the detail page was never opened.
    recordEpisodeWatched({ animeHref: aHref, animeTitle: aTitle, epNum, isLast: nextEpParam === "" }).catch(() => {});
  }, [paramEpNum, episode, animeTitle, animeHref, animeTitleParam, animeParam, nextEpParam]);

  // Keep serversRef in sync so timers/async handlers can read the live count.
  useEffect(() => { serversRef.current = servers; }, [servers]);
  // Next href through a ref so long-lived progress timers see the live value
  // without re-subscribing (stale closures must not skip the countdown).
  useEffect(() => { nextEpRef.current = nextEpisodeHref; }, [nextEpisodeHref]);

  const active = servers[activeIdx];
  // Episode label used for history/continue-watching ("الحلقة N" once the
  // scraper resolves it; the URL number as fallback), and the player-header
  // title that shows the anime name AND the episode label — never the same
  // string twice (the old scrapers set episodeTitle = animeTitle).
  const episodeLabel = useMemo(() => {
    const ep = (title || "").trim();
    if (ep) return ep;
    return paramEpNum != null ? `${t.episode} ${paramEpNum}` : "";
  }, [title, paramEpNum]);

  const displayTitle = useMemo(() => {
    const ep = episodeLabel;
    const anime = (animeTitle || "").trim();
    if (!ep) return anime;
    if (!anime) return ep;
    const e = ep.toLowerCase();
    const a = anime.toLowerCase();
    if (e === a || e.includes(a)) return ep;
    return `${anime} — ${ep}`;
  }, [episodeLabel, animeTitle]);

  // Season-aware identity for the companion. Source titles are often just the
  // base series ("Naruto") while the user watches a later season/series, which
  // made the AI answer about the old season. Surface the slug's season marker
  // and romaji title so the context pins the exact work.
  const companionCtx = useMemo(() => {
    const dec = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };
    const parentHref = animeHref || (animeParam ? dec(animeParam) : "");
    const base = (animeTitleParam ? dec(animeTitleParam) : "") || animeTitle || episodeLabel || "";
    const seasonFromTitle = seasonNum(base);
    const seasonFromHref = seasonNum(parentHref) || (episode ? seasonNum(dec(episode)) : 0);
    // Only append a season when the title doesn't already carry one and the
    // URL slug proves it (e.g. "...-2nd-season"); never invent one.
    const title = seasonFromTitle === 0 && seasonFromHref > 0
      ? `${base} (الموسم ${seasonFromHref})`
      : base;
    const alt = slugToTitle(parentHref);
    const altTitle = alt && alt.toLowerCase() !== base.toLowerCase() ? alt : "";
    return { title, season: seasonFromTitle || seasonFromHref || 0, altTitle };
  }, [animeTitleParam, animeTitle, episodeLabel, animeHref, animeParam, episode]);
  // Gate playback on the selection: until the user picks a server, the player
  // gets NO source so background pre-resolution can't start audio/video behind
  // the picker. Flips on the moment `picked` is set by pickServer.
  const videoUrl = picked ? (active?.videoUrl ?? null) : null;
  const isPlaying = active?.status === "playing" && !!videoUrl;
  const isWebView = active?.status === "webview";
  const iframeUrl = getIframeUrl(active?.server);

  // CDNs refuse playback without the right Referer. Each provider has a
  // canonical embed origin (mp4upload's CDN wants www.mp4upload.com, not
  // mp4upload.com or s14.mp4upload.com). Derive the right one from the
  // video URL's host first; fall back to the iframe origin.
  // Rebuilding this on every render (the player-state poll re-renders the
  // screen up to twice a second) re-parsed the URL + ran every provider regex
  // and handed useVideoPlayer a brand-new source object each time — which can
  // trigger redundant player.replace() churn. Memoize on the only inputs it
  // actually depends on.
  const videoSource = useMemo(() => {
    if (!videoUrl) return "";
    // Local downloaded file — hand the URI straight to the player; no CDN
    // headers / content-type sniffing needed for an on-disk .mp4.
    if (videoUrl.startsWith("file://")) return videoUrl;
    try {
      const provider = active?.server.provider || "generic";
      return {
        uri: videoUrl,
        headers: videoPlaybackHeaders(videoUrl, iframeUrl, provider),
        contentType: videoContentType(videoUrl, provider),
        // Disk cache for replays + replaying what the silent prefetch already
        // buffered (lib/prefetch.ts). Already supported by the shipped binary.
        useCaching: true,
      };
    } catch {
      return videoUrl;
    }
  }, [videoUrl, iframeUrl]);

  const player = useVideoPlayer(videoSource as any, (p) => {
    // Buffer FAR ahead of Android's 20s default. vid3rb (anime3rb) throttles
    // free streams to ~2.5× the file's bitrate (signed speed= param on the
    // CDN URL) and its edge host intermittently drops connections — with only
    // 20s of cushion every blip surfaced as a mid-watch rebuffer. A few
    // minutes of forward buffer accumulates surplus during the throttled
    // download and rides out both bitrate peaks and CDN reconnects. Time
    // must win over ExoPlayer's byte budget or the 1080p cushion gets
    // capped long before 300s.
    p.bufferOptions = {
      preferredForwardBufferDuration: 300,
      // After a pause/stall, accumulate a bigger cushion before resuming so the
      // throttled vid3rb CDN doesn't drop us straight into another stall (the
      // classic stutter→resume→stutter loop). expo-video conflates the
      // start-buffer and rebuffer-resume thresholds into this one Android knob,
      // so 4s is a balanced startup/rebuffer threshold for this player.
      // It starts faster on healthy streams while the adaptive watcher below
      // now steps down early when the forward cushion is shrinking instead of
      // dropping straight from a stall back into another (the stutter loop).
      minBufferForPlayback: 4,
      maxBufferBytes: 0,
      prioritizeTimeOverSizeThreshold: true,
      // iOS: let AVPlayer delay playback to build a stall-proof buffer instead
      // of starting on a thread-bare one and rebuffering immediately.
      waitsToMinimizeStalling: true,
    };
    // Keep audio (and PiP) alive when the app goes to the background. Both need
    // the expo-video config plugin from the APK build; on an older binary (OTA)
    // the native side rejects them — never let that kill player setup.
    try {
      p.staysActiveInBackground = true;
      p.showNowPlayingNotification = true;
    } catch {}
    if (videoUrl && resumeMs > 0) {
      p.currentTime = resumeMs / 1000;
    }
    // Don't auto-start on a blurred screen (background episode) or while the
    // watch-party host gate is holding the room.
    if (videoUrl && focusedRef.current && !holdPlaybackRef.current) p.play();
  });

  // Kill audio the moment the user leaves this screen. expo-video releases
  // the player on unmount, but not when another route is pushed on top —
  // and release can lag behind navigation, leaving the episode audible on
  // the main page. Pause explicitly on blur/unmount.
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      // On focus, restore the orientation that matches the current phase: the
      // selector page stays PORTRAIT, the player is LANDSCAPE. (Returning from
      // the anime page re-locked portrait on the way out.)
      ScreenOrientation.lockAsync(
        pickedRef.current
          ? ScreenOrientation.OrientationLock.LANDSCAPE
          : ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => {});
      return () => {
        // Mark blurred FIRST so any in-flight auto-play timer that fires after
        // this no-ops instead of restarting audio on the backgrounded screen.
        focusedRef.current = false;
        try { player.pause(); } catch {}
        // Never let the hidden prefetch keep downloading off-screen.
        stopPrefetch();
      };
    }, [player]),
  );

  // Force play on native player when source changes. A server handoff carries
  // the exact position into the replacement source; retrying the seek while
  // the new media becomes ready avoids a race where an early seek is ignored.
  useEffect(() => {
    if (!videoUrl || !player) return;
    const seekToMs = pendingSeekRef.current;
    const tryPlay = () => {
      // Never auto-resume a blurred (backgrounded) screen, or a host-gated room.
      if (!focusedRef.current || holdPlaybackRef.current) return;
      try {
        if (seekToMs > 0) player.currentTime = seekToMs / 1000;
        player.play();
      } catch {}
    };
    tryPlay();
    const t1 = setTimeout(tryPlay, 500);
    const t2 = setTimeout(tryPlay, 1500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      if (seekToMs > 0 && pendingSeekRef.current === seekToMs) pendingSeekRef.current = 0;
    };
  }, [videoUrl, player, resumeMs, serverStartPositionMs]);

  // Self-heal / fallback. Providers with a failed terminal mode never fall back to the embed;
  // others fall to WebView when direct playback can't be recovered.
  //
  // Healing is done IN PLACE whenever possible: on flaky connections ExoPlayer
  // surfaces transient network drops as player.status === 'error', and the old
  // recovery (null the URL → "Connecting…" spinner → re-scrape the embed →
  // rebuild the whole player) made the screen visibly "refresh" several times
  // per episode. The signed URL is almost always still valid after a blip, so
  // the first recovery is player.replaceAsync(sameSource) + seek back — the
  // VideoView never unmounts and the user only sees a brief buffer. Only when
  // that fails do we re-extract a fresh URL (real token expiry), and even then
  // the video stays mounted until the fresh URL arrives.
  useEffect(() => {
    if (!videoUrl || !player) return;
    const idx = activeIdx;
    let hasStarted = false;
    let cancelled = false;
    let lastPosMs = 0;
    let healing = false;
    let loadingExtensions = 0;
    // ExoPlayer flickers status==='error' on transient network blips during a
    // throttled stream. Reloading on the first flicker caused the visible
    // reload loop; require the error to PERSIST before healing.
    let errorSince = 0;

    const prov = servers[idx]?.server.provider;
    // videa/okru CDNs are far away and routinely need >14s to first byte —
    // bailing early there kicked perfectly good direct URLs to the embed.
    const failMs = prov === "videa" || prov === "okru" ? 22000 : 14000;
    let graceUntil = Date.now() + failMs;

    const fail = () => {
      if (cancelled) return;
      const handoffMs = Math.max(lastPosMs, playbackPositionMsRef.current);
      if (handoffMs > 0) {
        pendingSeekRef.current = handoffMs;
        setServerStartPositionMs(handoffMs);
      }
      setServers((p) => p.map((s, i) =>
        i === idx ? { ...s, status: failStatus(p[idx]?.server.provider), videoUrl: null } : s));
    };

    const heal = async () => {
      if (healing || cancelled) return;
      healing = true;
      const srv = servers[idx]?.server;
      const embedUrl = getIframeUrl(srv);
      const attempts = retryCountRef.current[idx] ?? 0;
      if (!srv || !embedUrl || attempts >= 3) { fail(); return; }
      retryCountRef.current[idx] = attempts + 1;
      const seekTo = lastPosMs;
      const playerError = String((player as any)?.error?.message || (player as any)?.error || "")
        .slice(0, 240) || null;
      void remoteLog("warn", "video", "native playback recovery", {
        provider: srv.provider,
        source: srv.source || null,
        stage: hasStarted ? "mid-watch" : "startup",
        attempt: attempts + 1,
        mediaHost: safeHost(videoUrl),
        embedHost: safeHost(embedUrl),
        playerError,
      });
      try {
        if (attempts === 0 && hasStarted) {
          // First mid-watch error: assume a transient network blip and reload
          // the SAME source in place — no scrape, no player teardown.
          await player.replaceAsync(videoSource as any);
        } else {
          // Never started, or the in-place reload already failed once:
          // re-extract a fresh URL from the embed page (token expiry).
          const r = await resolveVideo(embedUrl, srv.provider, { priority: true, fresh: true }).catch(() => null);
          if (cancelled) return;
          if (!r?.success || !r.data?.videoUrl) { fail(); return; }
          const fresh = r.data.videoUrl;
          if (fresh !== videoUrl) {
            // New URL — let the keyed useVideoPlayer recreation take over;
            // this effect re-runs with the new videoUrl.
            pendingSeekRef.current = seekTo;
            setServers((p) => p.map((s, i) =>
              i === idx ? { ...s, status: "playing" as ServerStatus, videoUrl: fresh } : s));
            return;
          }
          // Extractor returned the SAME url — it's still valid, the player
          // just choked on the network. Reload it in place.
          await player.replaceAsync(videoSource as any);
        }
        if (cancelled) return;
        if (seekTo > 0) { try { player.currentTime = seekTo / 1000; } catch {} }
        try { player.play(); } catch {}
        // Re-arm the startup watch for the reloaded source.
        hasStarted = false;
        loadingExtensions = 0;
        graceUntil = Date.now() + failMs;
        healing = false;
      } catch (error) {
        void remoteLog("error", "video", "native playback recovery failed", {
          provider: srv.provider,
          mediaHost: safeHost(videoUrl),
          error: String(error).slice(0, 240),
        });
        fail();
      }
    };

    // Poll for "started playing" + errors. Fast (250ms) only until playback
    // starts; after that 1s is plenty (error healing already requires a 1.5s
    // persistent error) and the 250ms cadence was waking the JS thread 4×/s for
    // the entire episode.
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const watchdogTick = () => {
      if (cancelled) return;
      if (!healing && focusedRef.current) { // don't heal a blurred screen
        try {
          if (player.duration > 0 || player.currentTime > 0) {
            hasStarted = true;
            if (player.currentTime > 0) lastPosMs = Math.round(player.currentTime * 1000);
          }
        } catch {}
        try {
          if ((player.status as string) === "error") {
            if (!errorSince) errorSince = Date.now();
            else if (Date.now() - errorSince >= 1500) { errorSince = 0; void heal(); }
          } else {
            errorSince = 0;
          }
        } catch {}
      }
      watchdogTimer = setTimeout(watchdogTick, hasStarted ? 1000 : 250);
    };
    watchdogTimer = setTimeout(watchdogTick, 250);

    // Startup deadline: if the player never produced a byte by the deadline,
    // recover. But if it is STILL actively loading (slow connection, big
    // manifest), extend the wait instead of restarting from scratch — killing
    // a slow-but-progressing load was another source of visible refreshes.
    const deadline = setInterval(() => {
      if (cancelled || healing || hasStarted || !focusedRef.current) return;
      // A party client paused by the host's start gate is INTENTIONALLY not
      // producing bytes — keep pushing the deadline out or the watchdog would
      // "heal" a healthy held stream and churn through every server.
      if (waitingForHostRef.current) { graceUntil = Date.now() + failMs; return; }
      if (Date.now() < graceUntil) return;
      try {
        if ((player.status as string) === "loading" && loadingExtensions < 3) {
          loadingExtensions += 1;
          graceUntil = Date.now() + 8000;
          return;
        }
        if (providerFailureMode(prov || "generic") === "failed") { void heal(); return; }
        setServers((p) => p.map((srv, i) =>
          i === idx ? { ...srv, status: "webview" as ServerStatus, videoUrl: null } : srv
        ));
        clearInterval(deadline);
      } catch {}
    }, 1000);

    return () => {
      cancelled = true;
      if (watchdogTimer) clearTimeout(watchdogTimer);
      clearInterval(deadline);
    };
  }, [videoUrl, player, activeIdx]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 4000);
  }, []);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  // Orientation follows the phase: PORTRAIT while the server selector is up,
  // LANDSCAPE once a server is picked and the player takes over. Reacts to the
  // pick transition so the rotation happens exactly when playback begins.
  useEffect(() => {
    ScreenOrientation.lockAsync(
      picked
        ? ScreenOrientation.OrientationLock.LANDSCAPE
        : ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => {});
  }, [picked]);

  // Load saved progress for every episode route, including in-place next/prev
  // navigation where this component remains mounted.
  useEffect(() => {
    if (!episode) return;
    let cancelled = false;
    getProgress(decodeURIComponent(episode)).then((entry) => {
      if (cancelled || !entry || entry.positionMs <= 0) return;
      pendingSeekRef.current = entry.positionMs;
      playbackPositionMsRef.current = entry.positionMs;
      setServerStartPositionMs(entry.positionMs);
      setResumeMs(entry.positionMs);
    });
    return () => { cancelled = true; };
  }, [episode]);

  // Control auto-hide + unmount cleanup (orientation handled above).
  useEffect(() => {
    scheduleHide();
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, [scheduleHide]);

  // Show a (frequency-capped) interstitial when an episode is opened. Opening
  // an episode is a natural break; the 3-min cap in lib/ads.ts keeps fast
  // next/prev hopping from spamming ads. No-op until ad IDs are configured.
  useEffect(() => {
    if (!episode) return;
    maybeShowInterstitial("before_episode");
  }, [episode]);

  // Some servers never report a usable position (a WebView embed whose player
  // lives in a cross-origin iframe, or a stream whose duration is unknown), so
  // the 5s save loop below never fires and the episode never reaches Continue
  // Watching. Create the entry as soon as playback actually starts; the real
  // position overwrites it on the next save.
  const startedSaveRef = useRef<string | null>(null);
  useEffect(() => {
    if (!episode) return;
    if (!isPlaying && !isWebView) return;
    const key = `${episode}|${activeIdx}`;
    if (startedSaveRef.current === key) return;
    startedSaveRef.current = key;
    const timer = setTimeout(() => {
      // A blurred screen (left on the stack, frozen) must never record — the
      // user may have deleted this anime from history in the meantime.
      if (!focusedRef.current) return;
      if (playbackPositionMsRef.current > 0) return; // a real save already landed
      saveProgress({
        episodeHref: decodeURIComponent(episode),
        episodeTitle: episodeLabel,
        animeTitle,
        animeHref,
        image: imgParam ? decodeURIComponent(imgParam) : "",
        positionMs: 0,
        durationMs: 0,
        url4up: url4up ? decodeURIComponent(url4up) : undefined,
        epNum: paramEpNum ?? undefined,
      });
    }, 6000);
    return () => clearTimeout(timer);
  }, [episode, isPlaying, isWebView, activeIdx, episodeLabel, animeTitle, animeHref, imgParam, url4up, paramEpNum]);

  // Save progress (native player)
  useEffect(() => {
    if (!isPlaying || !player || !episode) return;
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => {
      try {
        if (!focusedRef.current) return; // frozen under another screen — no resurrecting deleted history
        const pos = player.currentTime * 1000;
        const dur = player.duration * 1000;
        if (pos > 0 && dur > 0) {
          playbackPositionMsRef.current = Math.round(pos);
          saveProgress({
            episodeHref: decodeURIComponent(episode),
            episodeTitle: episodeLabel,
            animeTitle,
            animeHref,
            image: imgParam ? decodeURIComponent(imgParam) : "",
            positionMs: Math.round(pos),
            durationMs: Math.round(dur),
            url4up: url4up ? decodeURIComponent(url4up) : undefined,
            epNum: paramEpNum ?? undefined,
          });
          maybeAutoAdvance(pos, dur);
          maybeMarkCompleted(pos, dur);
        }
      } catch {}
    }, 5000);
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
      // Persist the final position when leaving / switching servers — a watch
      // shorter than one 5s tick would otherwise never reach Continue Watching.
      try {
        const pos = Math.round((player.currentTime || 0) * 1000);
        const dur = Math.round((player.duration || 0) * 1000);
        if (pos > 0) {
          saveProgress({
            episodeHref: decodeURIComponent(episode),
            episodeTitle: episodeLabel,
            animeTitle,
            animeHref,
            image: imgParam ? decodeURIComponent(imgParam) : "",
            positionMs: pos,
            durationMs: dur,
            url4up: url4up ? decodeURIComponent(url4up) : undefined,
            epNum: paramEpNum ?? undefined,
          });
          // Leaving inside the final <5s tick must not skip the completion
          // mark — the save just carried the same 80% evidence.
          maybeMarkCompleted(pos, dur);
        }
      } catch {}
    };
  }, [isPlaying, player, episode, title, animeTitle, animeHref, url4up, imgParam, maybeMarkCompleted]);

  // Save progress (WebView player) — receives position from injected JS
  const lastWebViewPos = useRef<{ pos: number; dur: number }>({ pos: 0, dur: 0 });

  const capturePlaybackPosition = useCallback(() => {
    let positionMs = playbackPositionMsRef.current;
    if (isWebView) {
      positionMs = Math.max(positionMs, lastWebViewPos.current.pos);
    } else {
      try {
        const nativeMs = player.currentTime * 1000;
        if (Number.isFinite(nativeMs) && nativeMs > 0) positionMs = nativeMs;
      } catch {}
    }
    const rounded = Math.max(0, Math.round(positionMs));
    if (rounded > 0) playbackPositionMsRef.current = rounded;
    return rounded;
  }, [isWebView, player]);

  const prepareServerHandoff = useCallback(() => {
    const positionMs = capturePlaybackPosition();
    if (positionMs > 0) {
      pendingSeekRef.current = positionMs;
      setServerStartPositionMs(positionMs);
    }
    return positionMs;
  }, [capturePlaybackPosition]);

  useEffect(() => {
    if (!isWebView || !episode) return;
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => {
      if (!focusedRef.current) return; // frozen under another screen — no resurrecting deleted history
      const { pos, dur } = lastWebViewPos.current;
      if (pos > 0 && dur > 0) {
        playbackPositionMsRef.current = Math.round(pos);
        saveProgress({
          episodeHref: decodeURIComponent(episode),
          episodeTitle: title,
          animeTitle,
          animeHref,
          image: imgParam ? decodeURIComponent(imgParam) : "",
          positionMs: Math.round(pos),
          durationMs: Math.round(dur),
          url4up: url4up ? decodeURIComponent(url4up) : undefined,
          epNum: paramEpNum ?? undefined,
        });
        maybeAutoAdvance(pos, dur);
        maybeMarkCompleted(pos, dur);
      }
    }, 5000);
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
      // Same as the native path: a short WebView watch must still be recorded.
      const { pos, dur } = lastWebViewPos.current;
      if (pos > 0) {
        saveProgress({
          episodeHref: decodeURIComponent(episode),
          episodeTitle: title,
          animeTitle,
          animeHref,
          image: imgParam ? decodeURIComponent(imgParam) : "",
          positionMs: Math.round(pos),
          durationMs: Math.round(dur),
          url4up: url4up ? decodeURIComponent(url4up) : undefined,
          epNum: paramEpNum ?? undefined,
        });
        maybeMarkCompleted(pos, dur);
      }
    };
  }, [isWebView, episode, title, animeTitle, animeHref, url4up, imgParam, maybeMarkCompleted]);

  // WebView progress message handler
  const onWebViewProgress = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "progress" && msg.pos > 0 && msg.dur > 0) {
        lastWebViewPos.current = { pos: msg.pos, dur: msg.dur };
        playbackPositionMsRef.current = Math.round(msg.pos);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (isPlaying || isWebView) scheduleHide();
  }, [isPlaying, isWebView, scheduleHide]);

  // ── LOAD SERVERS ──
  const loadGenerationRef = useRef(createGenerationGuard());
  const autoLoadKeyRef = useRef("");
  const loadServers = useCallback(async (force = false) => {
    if (!episode) return;
    const autoLoadKey = [episode, url4up, url3rb, animeParam, animeTitleParam, epNumParam].join("|");
    if (!force && autoLoadKeyRef.current === autoLoadKey) return;
    if (!force) autoLoadKeyRef.current = autoLoadKey;
    const generation = loadGenerationRef.current.next();
    if (localUri) {
      setServers([localServer(localUri)]);
      setTitle(animeTitleParam ? decodeURIComponent(animeTitleParam) : "");
      setAnimeTitle(animeTitleParam ? decodeURIComponent(animeTitleParam) : "");
      if (animeParam) setAnimeHref(decodeURIComponent(animeParam));
      setLoading(false);
      return;
    }
    if (!force) setLoading(true);
    setError(null);
    if (!force) setServers([]);
    setNoServersFinal(false);
    retryCountRef.current = {};
    pendingSeekRef.current = 0;
    try {
      const url = decodeURIComponent(episode);
      let resolvedAnime = animeParam ? decodeURIComponent(animeParam) : "";
      if (!resolvedAnime) {
        try {
          const { toAnimeUrl } = require("../../lib/favorites") as typeof import("../../lib/favorites");
          resolvedAnime = toAnimeUrl(url) || "";
        } catch {}
      }
      // Apply a server payload to the screen. merge=true (manual refresh, or
      // the complete list landing after a partial) preserves each existing
      // server's state (resolving/playing/failed) instead of resetting it.
      const applyPayload = (payload: Awaited<ReturnType<typeof fetchCompleteVideoServers>>, merge: boolean, append = false) => {
        const states: ServerState[] = sortVideoServers(payload.data.servers).map((server) => ({
          server,
          status: server.videoUrl ? "playing" : "idle",
          videoUrl: server.videoUrl || null,
        }));
        setServers((previous) => {
          const unchanged = (next: ServerState[]) =>
            next.length === previous.length && next.every((state, index) => {
              const old = previous[index];
              return old?.server.iframeUrl === state.server.iframeUrl &&
                old.status === state.status && old.videoUrl === state.videoUrl;
            });
          if (!merge) return unchanged(states) ? previous : states;
          const existing = new Map(previous.map((state) => [state.server.iframeUrl, state]));
          if (append) {
            for (const state of states) {
              const current = existing.get(state.server.iframeUrl);
              if (!current || (!current.videoUrl && state.videoUrl)) existing.set(state.server.iframeUrl, state);
            }
            const next = sortVideoServers([...existing.values()].map((state) => state.server)).map(
              (server) => existing.get(server.iframeUrl)!,
            );
            return unchanged(next) ? previous : next;
          }
          const next = states.map((state) => {
            const current = existing.get(state.server.iframeUrl);
            return current && !current.videoUrl && state.videoUrl ? state : current || state;
          });
          return unchanged(next) ? previous : next;
        });
        if (!merge) setActiveIdx(0);
        setTitle(payload.data.episodeTitle || "");
        setAnimeTitle(payload.data.animeTitle || "");
        setAnimeHref(payload.data.animeHref || resolvedAnime);
        setNextEpisodeHref(nextEpParam || payload.data.navigation?.next || null);
        setPrevEpisodeHref(prevEpParam || payload.data.navigation?.prev || null);
      };
      let partialApplied = false;
      const res = await fetchCompleteVideoServers({
        episodeUrl: url,
        url4up: url4up ? decodeURIComponent(url4up) : undefined,
        url3rb: url3rb ? decodeURIComponent(url3rb) : undefined,
        animeHref: resolvedAnime,
        animeTitle: animeTitleParam ? decodeURIComponent(animeTitleParam) : undefined,
        episodeNumber: paramEpNum,
        force,
        onCandidates: (candidates) => {
          if (!loadGenerationRef.current.isCurrent(generation)) return;
          partialApplied = true;
          applyPayload(candidates, force || serversRef.current.length > 0, true);
          setLoading(false);
        },
        // Primary source's servers land first — show them immediately instead
        // of waiting on the slower anime4up/anime3rb cross-source lookups.
        onPartial: (partial) => {
          if (!loadGenerationRef.current.isCurrent(generation)) return;
          if (!partial.success || partial.data.servers.length === 0) return;
          partialApplied = true;
          // Merge (not replace) when servers are already on screen — a manual
          // refresh must not wipe the playing server's state or selection.
          applyPayload(partial, force || serversRef.current.length > 0, true);
          setLoading(false);
        },
      });
      if (!loadGenerationRef.current.isCurrent(generation)) return;
      setNoServersFinal(true);
      if (!res.success || res.data.servers.length === 0) {
        setTitle(res.data.episodeTitle || "");
        setAnimeTitle(res.data.animeTitle || "");
        setServers([]);
        return;
      }
      applyPayload(res, force || partialApplied);
    } catch (e: any) {
      if (loadGenerationRef.current.isCurrent(generation)) setError(e.message || "Failed to load");
    } finally {
      if (!force && loadGenerationRef.current.isCurrent(generation)) setLoading(false);
    }
  }, [episode, localUri, url4up, url3rb, animeParam, animeTitleParam, epNumParam, paramEpNum, nextEpParam, prevEpParam]);

  useEffect(() => { void loadServers(); }, [loadServers]);

  // Derive prev/next from the parent anime when not passed in URL params.
  // Triggers when:
  //   - user came from "حلقات جديدة" modal (anime URL is passed)
  //   - user came from continue-watching history (anime URL might not be set)
  //   - user opened an episode link directly
  // For the no-anime-param case we fall back to deriving the anime URL
  // from the episode slug (strip الحلقة-N tail + swap /episode/→/anime/).
  useEffect(() => {
    if (localUri) return; // offline file — no prev/next scraping
    if (nextEpisodeHref && prevEpisodeHref) return;
    if (!episode) return;
    const currentHref = decodeURIComponent(episode);

    // Resolve anime URL: prefer the param, else derive from the slug.
    let resolvedAnime: string | null = animeParam || null;
    if (!resolvedAnime) {
      try {
        const { toAnimeUrl } = require("../../lib/favorites") as typeof import("../../lib/favorites");
        resolvedAnime = toAnimeUrl(currentHref);
      } catch {}
    }
    if (!resolvedAnime) return;

    let cancelled = false;
    (async () => {
      try {
        const { fetchEpisodes } = await import("../../lib/api");
        const res = await fetchEpisodes(resolvedAnime!);
        if (cancelled || !res?.success) return;
        const byNum = [...(res.data.episodes || [])].sort(
          (a, b) => (a.number ?? 0) - (b.number ?? 0),
        );
        // Normalize hrefs on both sides so URL-encoding mismatches
        // (Arabic %xx vs raw) don't prevent the lookup.
        const norm = (u: string) => {
          if (!u) return "";
          try { return decodeURIComponent(u).replace(/\/+$/, ""); }
          catch { return u.replace(/\/+$/, ""); }
        };
        const needle = norm(currentHref);
        let myIdx = byNum.findIndex((e) => norm(e.href || "") === needle);
        // Fallback: match by episode number if href shapes differ.
        if (myIdx === -1) {
          const numMatch = currentHref.match(/الحلقة[\s\-_]*(\d+)/);
          if (numMatch) {
            const num = parseInt(numMatch[1], 10);
            myIdx = byNum.findIndex((e) => e.number === num);
          }
        }
        if (myIdx === -1) return;
        const nextE = byNum[myIdx + 1]?.href || null;
        const prevE = byNum[myIdx - 1]?.href || null;
        if (!nextEpisodeHref && nextE) setNextEpisodeHref(nextE);
        if (!prevEpisodeHref && prevE) setPrevEpisodeHref(prevE);
        // Also remember the anime href so the "go to anime page" link works.
        if (resolvedAnime && !animeHref) setAnimeHref(resolvedAnime);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [animeParam, episode, nextEpisodeHref, prevEpisodeHref, animeHref]);

  // ── PREFETCH neighbouring episodes' anime3rb servers ──
  // Once the CURRENT episode's anime3rb server is resolved, warm the caches for
  // the next (and previous) episode in the background. fetchAnime3rbServers
  // stores its result + the vid3rb player sources, so when the user hits
  // next/prev the anime3rb server is already built and plays instantly. This is
  // what makes binge-watching feel instant — only the first episode of a
  // session pays the episode-page fetch.
  const a3rbServerCount = servers.filter((state) => state.server.source === "anime3rb").length;
  const a3rbPrefetchedRef = useRef<string | null>(null);
  useEffect(() => {
    if (a3rbServerCount === 0) return; // wait until the current one resolved
    if (!episode) return;
    const currentHref = decodeURIComponent(episode);
    // Same epNum derivation as the fetch effect.
    let epNum: number | null = paramEpNum;
    if (epNum == null) {
      const um = currentHref.match(/الحلقة[\s\-_]*(\d+)/);
      if (um) epNum = parseInt(um[1], 10);
    }
    if (epNum == null) {
      const am = currentHref.match(/\/episode\/[^/]+\/(\d+)/);
      if (am) epNum = parseInt(am[1], 10);
    }
    if (epNum == null) return;
    // Same lookupTitle derivation as the fetch effect.
    let lookupTitle = (animeTitleParam ? decodeURIComponent(animeTitleParam) : "") || animeTitle;
    if (!lookupTitle) {
      try {
        const { toAnimeUrl } = require("../../lib/favorites") as typeof import("../../lib/favorites");
        const animeUrl = animeParam || toAnimeUrl(currentHref);
        if (animeUrl) {
          const slug = decodeURIComponent(new URL(animeUrl).pathname.replace(/\/+$/, "").split("/").pop() || "");
          lookupTitle = slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
        }
      } catch {}
    }
    if (!lookupTitle) return;
    const guard = `${lookupTitle}#${epNum}`;
    if (a3rbPrefetchedRef.current === guard) return; // already prefetched for this ep
    a3rbPrefetchedRef.current = guard;
    // Hand the derived context to the silent byte-prefetch effect below.
    prefetchCtxRef.current = { title: lookupTitle, epNum };
    // Next is the strong signal (autoplay/binge); previous is cheap insurance.
    prefetchAnime3rbServers(lookupTitle, epNum + 1);
    if (epNum > 1) prefetchAnime3rbServers(lookupTitle, epNum - 1);
  }, [a3rbServerCount, episode, animeTitle, animeTitleParam, animeParam, paramEpNum]);

  // ── SILENT NEXT-EPISODE PREFETCH (صفر انتظار) ──
  // 20s into healthy playback, quietly resolve next episode's vid3rb URL and
  // pre-buffer two minutes into the disk cache with a muted, viewless player.
  // Tapping next then starts near-instantly. Data-usage control is the
  // settings toggle (there is no Wi-Fi/cellular signal in this binary).
  useEffect(() => {
    if (!isPlaying || !nextEpisodeHref) return;
    const timer = setTimeout(() => {
      const ctx = prefetchCtxRef.current;
      if (!ctx) return;
      void prefetchNextEpisode({
        animeTitle: ctx.title,
        epNum: ctx.epNum + 1,
        shouldRun: () => focusedRef.current && !isPausedRef.current,
      });
    }, 20_000);
    return () => {
      clearTimeout(timer);
      stopPrefetch();
    };
  }, [isPlaying, nextEpisodeHref]);

  // ── MANUAL REFRESH ──
  // Re-scrape the complete list while preserving state for unchanged servers.
  const refreshServers = useCallback(async () => {
    if (refreshing || !episode) return;
    setRefreshing(true);
    try {
      await loadServers(true);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, episode, loadServers]);

  // ── RESOLVE ACTIVE SERVER ──
  const activeResolutionRef = useRef(0);
  useEffect(() => { activeResolutionRef.current += 1; }, [episode]);
  useEffect(() => {
    if (!picked) return; // selection gate — don't resolve/play until a server is chosen
    if (servers.length === 0) return;
    const state = servers[activeIdx];
    if (!state || state.status !== "idle") return;
    const srv = state.server;
    const url = getIframeUrl(srv);
    if (!url) {
      setServers((p) => p.map((s, i) => i === activeIdx ? { ...s, status: "failed" } : s));
      return;
    }

    const idx = activeIdx;

    // WebView-only providers (including WitAnime's session-bound stream gates)
    // cannot yield a native media URL. Open them immediately instead of
    // waiting through a doomed 40-second extraction.
    if (failStatus(srv.provider) === "webview") {
      setServers((p) => p.map((s, i) => i === idx ? { ...s, status: "webview" } : s));
      return;
    }

    setServers((p) => p.map((s, i) => i === idx ? { ...s, status: "resolving" } : s));
    const resolution = ++activeResolutionRef.current;
    void (async () => {
      // Warm result first (90s cache): when the silent prefetch just resolved
      // this same server URL, this returns it verbatim — so the disk-cache
      // segments it buffered are actually hit instead of being bypassed by a
      // fresh (possibly re-signed) URL.
      let result = await resolveVideo(url, srv.provider, { priority: true }).catch(() => null);
      if (activeResolutionRef.current !== resolution) return;
      if (!result?.success || !result.data?.videoUrl) {
        result = await resolveVideo(url, srv.provider, { priority: true, fresh: true }).catch(() => null);
        if (activeResolutionRef.current !== resolution) return;
      }
      setServers((p) => p.map((s, i) =>
        i !== idx || s.server.iframeUrl !== srv.iframeUrl
          ? s
          : result?.success && result.data?.videoUrl
            ? { ...s, status: "playing", videoUrl: result.data.videoUrl, subtitles: result.data.subtitles }
            : { ...s, status: failStatus(srv.provider), videoUrl: null }));
    })();
  }, [activeIdx, servers.length > 0 ? servers[activeIdx]?.status : null, picked, episode]);

  // A server warmed during discovery (status "playing" with a pre-resolved URL)
  // skipped the resolve above, so its sidecar subtitles were never attached.
  // resolveVideo is cached for that exact result — this call is instant.
  useEffect(() => {
    if (!picked) return;
    const state = servers[activeIdx];
    if (!state || state.status !== "playing" || state.subtitles !== undefined) return;
    if (state.server.provider !== "anime4upcdn") return;
    const url = getIframeUrl(state.server);
    if (!url) return;
    let cancelled = false;
    resolveVideo(url, state.server.provider, { priority: false }).then((result) => {
      if (cancelled) return;
      const subtitles = result.success ? result.data?.subtitles : undefined;
      if (!subtitles) return;
      setServers((p) => p.map((s, i) =>
        i === activeIdx && s.server.iframeUrl === state.server.iframeUrl
          ? { ...s, subtitles }
          : s));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [picked, activeIdx, servers.length > 0 ? servers[activeIdx]?.status : null, servers.length > 0 ? servers[activeIdx]?.server.provider : null]);

  // Auto-advance to next server on failure (only after a server was chosen —
  // during selection the active index must stay put).
  useEffect(() => {
    if (!picked) return;
    if (servers.length === 0) return;
    const state = servers[activeIdx];
    if (state?.status !== "failed") return;
    const next = servers.findIndex((s, i) => i !== activeIdx && (s.status === "idle" || s.status === "playing" || s.status === "webview"));
    if (next !== -1) {
      prepareServerHandoff();
      setActiveIdx(next);
    }
  }, [servers, activeIdx, picked, prepareServerHandoff]);

  const selectServer = useCallback((idx: number) => {
    if (idx !== activeIdx) prepareServerHandoff();
    // A failed server gets a fresh chance when the user explicitly taps it —
    // reset to idle so the resolve effect re-runs the extraction.
    retryCountRef.current[idx] = 0;
    setServers((p) => p.map((s, i) =>
      i === idx && s.status === "failed" ? { ...s, status: "idle", videoUrl: null } : s));
    setActiveIdx(idx);
    setBufferAhead(null);
    setPickerOpen(false);
  }, [activeIdx, prepareServerHandoff]);

  // Pick a server from the selection layout → resolve + play it directly.
  const pickServer = useCallback((idx: number) => {
    loadGenerationRef.current.next();
    _cancelBackground();
    setNoServersFinal(true);
    selectServer(idx);
    setPicked(true);
  }, [selectServer]);

  // Servers ordered for the selection layout: anime3rb (recommended) first,
  // then by quality FHD → HD → SD, with provider rank as a final tiebreak.
  // `orig` keeps the index into `servers` so a tap maps back to the right one.
  const orderedServers = useMemo(() =>
    servers
      .map((s, orig) => ({ s, orig }))
      .sort((a, b) => {
        const ra = a.s.server.source === "anime3rb" ? 0 : 1;
        const rb = b.s.server.source === "anime3rb" ? 0 : 1;
        if (ra !== rb) return ra - rb;
        // Anime3rb remains first with its manually selectable quality entries.
        // Among alternate providers, surface HLS/ABR before fixed mirrors.
        const aa = providerSupportsAdaptivePlayback(a.s.server.provider);
        const ab = providerSupportsAdaptivePlayback(b.s.server.provider);
        if (aa !== ab) return aa ? -1 : 1;
        const qa = qualityScore(a.s.server.name);
        const qb = qualityScore(b.s.server.name);
        if (qa !== qb) return qb - qa;
        const pa = providerRank(a.s.server.provider);
        const pb = providerRank(b.s.server.provider);
        return pa - pb;
      }),
    [servers]);

  // Skip +/- 10s
  const skipBack = useCallback(() => {
    if (partyClientRef.current) return;
    if (isPlaying && player) {
      try { player.currentTime = Math.max(0, player.currentTime - 10); } catch {}
    } else if (isWebView) {
      webViewRef.current?.injectJavaScript(`
        try{var v=document.querySelector('video');if(v)v.currentTime=Math.max(0,v.currentTime-10);
        else if(typeof jwplayer==='function'){var p=jwplayer();if(p)p.seek(Math.max(0,p.getPosition()-10));}
        }catch(e){}
      `);
    }
    partyPulseRef.current(); // host: push the new position to viewers now
  }, [isPlaying, isWebView, player]);

  const skipForward = useCallback(() => {
    if (partyClientRef.current) return;
    if (isPlaying && player) {
      try { player.currentTime = Math.min(player.currentTime + 10, player.duration || Infinity); } catch {}
    } else if (isWebView) {
      webViewRef.current?.injectJavaScript(`
        try{var v=document.querySelector('video');if(v)v.currentTime=Math.min(v.duration,v.currentTime+10);
        else if(typeof jwplayer==='function'){var p=jwplayer();if(p)p.seek(Math.min(p.getDuration(),p.getPosition()+10));}
        }catch(e){}
      `);
    }
    partyPulseRef.current();
  }, [isPlaying, isWebView, player]);

  const skipForward85 = useCallback(() => {
    if (partyClientRef.current) return;
    if (isPlaying && player) {
      try { player.currentTime = Math.min(player.currentTime + 85, player.duration || Infinity); } catch {}
    } else if (isWebView) {
      webViewRef.current?.injectJavaScript(`
        try{var v=document.querySelector('video');if(v)v.currentTime=Math.min(v.duration,v.currentTime+85);
        else if(typeof jwplayer==='function'){var p=jwplayer();if(p)p.seek(Math.min(p.getDuration(),p.getPosition()+85));}
        }catch(e){}
      `);
    }
    partyPulseRef.current();
  }, [isPlaying, isWebView, player]);

  const performSkip = useCallback((active: ActiveSkip) => {
    if (partyClientRef.current) return;
    const targetTime = active.interval.endTime;
    if (isPlaying && player) {
      try { player.currentTime = targetTime; } catch {}
    } else if (isWebView) {
      webViewRef.current?.injectJavaScript(`
        try{var v=document.querySelector('video');if(v)v.currentTime=${targetTime};
        else if(typeof jwplayer==='function'){var p=jwplayer();if(p)p.seek(${targetTime});}
        }catch(e){}
      `);
    }
    partyPulseRef.current();
    showToast(active.type === "op" ? t.introSkipped : t.outroSkipped);
  }, [isPlaying, isWebView, player, showToast]);

  // Next episode — carry cross-source url4up + anime context so the
  // anime4up servers keep showing on the next episode.
  const goNextEpisode = useCallback((keepAutoplay = false) => {
    if (partyClientRef.current) return; // host drives episode changes
    if (!nextEpisodeHref) return;
    router.replace({
      pathname: `/watch/${encodeURIComponent(nextEpisodeHref)}`,
      params: {
        url4up: "",
        anime: animeParam || "",
        img: imgParam || "",
        animeTitle: animeTitleParam || "",
        epNum: paramEpNum != null ? String(paramEpNum + 1) : "",
        // Manual tap → land on the server picker like a fresh episode.
        // Only autoplay-at-end (keepAutoplay) continues straight into playback.
        ...(keepAutoplay === true ? { auto: "1" } : {}),
      },
    });
  }, [nextEpisodeHref, animeParam, imgParam, animeTitleParam, paramEpNum]);

  // Expose goNextEpisode to the progress timers (autoplay-at-end keeps playing
  // directly, so it passes keepAutoplay=true).
  useEffect(() => { goNextRef.current = () => goNextEpisode(true); }, [goNextEpisode]);

  // Previous episode — manual only, always lands on the server picker.
  const goPrevEpisode = useCallback(() => {
    if (partyClientRef.current) return; // host drives episode changes
    if (!prevEpisodeHref) return;
    router.replace({
      pathname: `/watch/${encodeURIComponent(prevEpisodeHref)}`,
      params: {
        url4up: "",
        anime: animeParam || "",
        img: imgParam || "",
        animeTitle: animeTitleParam || "",
        epNum: paramEpNum != null ? String(paramEpNum - 1) : "",
      },
    });
  }, [prevEpisodeHref, animeParam, imgParam, animeTitleParam, paramEpNum]);

  // ── EPISODE LIST PANEL ──
  // The full episode list is fetched lazily the first time the panel opens and
  // cached per anime href for the rest of the session.
  const openEpisodes = useCallback(async () => {
    if (partyClientRef.current) return; // host drives episode changes
    setEpisodesOpen(true);
    setCompanionOpen(false);
    if (!episode) return;
    const currentHref = decodeURIComponent(episode);
    let resolvedAnime: string | null = animeParam || null;
    if (!resolvedAnime) {
      try {
        const { toAnimeUrl } = require("../../lib/favorites") as typeof import("../../lib/favorites");
        resolvedAnime = toAnimeUrl(currentHref);
      } catch {}
    }
    if (!resolvedAnime) return;
    if (epListForRef.current === resolvedAnime && epList.length > 0) return;
    const token = ++epFetchRef.current;
    setEpListLoading(true);
    try {
      const { fetchEpisodes } = await import("../../lib/api");
      const res = await fetchEpisodes(resolvedAnime);
      if (epFetchRef.current !== token) return; // a newer open superseded this
      if (res?.success) {
        const byNum = [...(res.data.episodes || [])].sort(
          (a, b) => (a.number ?? 0) - (b.number ?? 0),
        );
        epListForRef.current = resolvedAnime;
        setEpList(byNum);
      }
    } catch {} finally {
      if (epFetchRef.current === token) setEpListLoading(false);
    }
  }, [episode, animeParam, epList.length]);

  const jumpToEpisode = useCallback((ep: Episode) => {
    if (partyClientRef.current || !ep.href) return; // host drives episode changes
    setEpisodesOpen(false);
    router.replace({
      pathname: `/watch/${encodeURIComponent(ep.href)}`,
      params: {
        url4up: "",
        anime: animeParam || "",
        img: imgParam || "",
        animeTitle: animeTitleParam || "",
        epNum: ep.number != null ? String(ep.number) : "",
      },
    });
  }, [animeParam, imgParam, animeTitleParam]);

  // ── رفيق الأنمي (spoiler-safe AI companion) ──
  const openCompanion = useCallback(() => {
    setPickerOpen(false);
    setEpisodesOpen(false);
    setCompanionOpen(true);
  }, []);

  const companionReasonText = useCallback((reason: string) => {
    switch (reason) {
      case "signin": return t.companionSignIn;
      case "rate_limited": return t.companionRateLimited;
      case "unavailable": return t.companionUnavailable;
      default: return t.companionError;
    }
  }, []);

  const sendCompanion = useCallback(async (mode: "chat" | "recap") => {
    if (companionBusyRef.current) return;
    const question = companionInput.trim();
    if (mode === "chat" && !question) return;
    if (!companionEpNum) return;
    const title = companionCtx.title || t.companion;
    const gen = companionGenRef.current;
    // Snapshot BEFORE appending this turn: the last exchanges go to the model
    // so it continues the conversation instead of starting over.
    const history = companionMsgs
      .slice(-8)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 400) }));
    companionBusyRef.current = true;
    setCompanionMsgs((m) => [...m, { role: "user", text: mode === "recap" ? t.companionRecap : question }]);
    setCompanionInput("");
    setCompanionBusy(true);
    const res = await askCompanion({
      mode,
      animeTitle: title,
      epNum: companionEpNum,
      question: mode === "chat" ? question : undefined,
      episodeTitle: episodeLabel || undefined,
      seasonNumber: companionCtx.season || undefined,
      altTitle: companionCtx.altTitle || undefined,
      history: mode === "chat" ? history : undefined,
    });
    companionBusyRef.current = false;
    if (companionGenRef.current !== gen) return; // episode changed mid-flight
    setCompanionBusy(false);
    if (res.ok) {
      setCompanionMsgs((m) => [...m, { role: "ai", text: res.answer }]);
    } else {
      showToast(companionReasonText(res.reason));
    }
  }, [companionInput, companionMsgs, companionEpNum, companionCtx, showToast, companionReasonText]);

  // Current index inside the fetched list (href match first, episode number as
  // fallback for cross-source href shapes).
  const currentEpIdx = useMemo(() => {
    if (!episode) return -1;
    const norm = (u: string) => {
      if (!u) return "";
      try { return decodeURIComponent(u).replace(/\/+$/, ""); }
      catch { return u.replace(/\/+$/, ""); }
    };
    const target = norm(decodeURIComponent(episode));
    let idx = epList.findIndex((e) => norm(e.href || "") === target);
    if (idx === -1 && paramEpNum != null) idx = epList.findIndex((e) => e.number === paramEpNum);
    return idx;
  }, [epList, episode, paramEpNum]);

  // Jump to the parent anime's detail page from inside the player. Prefer the
  // explicit anime param, then the scraped href, then derive the anime URL from
  // the episode slug (strip الحلقة-N + swap /episode/→/anime/) so the button
  // works even when the episode was opened cold (home / history / deep link).
  const goToAnimePage = useCallback(() => {
    let href = (animeParam ? decodeURIComponent(animeParam) : "") || animeHref || "";
    if (!href && episode) {
      try {
        const { toAnimeUrl } = require("../../lib/favorites") as typeof import("../../lib/favorites");
        href = toAnimeUrl(decodeURIComponent(episode)) || "";
      } catch {}
    }
    if (!href) return;
    try { player?.pause(); } catch {}
    // router.push keeps this watch screen mounted underneath, so the unmount
    // cleanup that re-locks portrait never fires — the anime page would inherit
    // landscape. Re-lock portrait explicitly before navigating.
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    router.push(`/anime/${encodeURIComponent(href)}`);
  }, [animeParam, animeHref, episode, player]);

  // Resize mode toggle
  // contain: fits whole video (may have black bars on non-16:9 sources)
  // fill:    stretches to use every pixel of the screen (slight distortion
  //          but NO content is cut off — what most users want for "fullscreen")
  const [videoFit, setVideoFit] = useState<"contain" | "fill">("contain");

  // Custom player state
  const [isPlayerPaused, setIsPlayerPaused] = useState(false);
  // Screen lock: when on, all gestures (tap-to-toggle, seek, brightness, the
  // whole control chrome) are suppressed so a pocket/accidental touch can't
  // pause or scrub. A single floating unlock button is the only live control.
  const [locked, setLocked] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferAhead, setBufferAhead] = useState<number | null>(null);
  const [seekValue, setSeekValue] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  // Watch-party: this device has buffered enough of the current episode to start.
  // Reported into the room so the host can wait for everyone before playing.
  const [selfReady, setSelfReady] = useState(false);

  // ── WATCH PARTY ──
  // Sync this player with a room. Host broadcasts its state on a heartbeat;
  // client follows it (see lib/watchParty). Inert when not in a room.
  const { user } = useAuth();
  const [partyPanelOpen, setPartyPanelOpen] = useState(false);
  // Nav params re-broadcast so a client can reopen the SAME episode. Passed
  // through verbatim (raw param strings) so host↔client round-trip is exact.
  const partyNavParams = useMemo<Record<string, string>>(() => ({
    url4up: url4up ?? "",
    url3rb: url3rb ?? "",
    anime: animeParam ?? "",
    img: imgParam ?? "",
    animeTitle: animeTitleParam ?? "",
    epNum: epNumParam ?? "",
  }), [url4up, url3rb, animeParam, imgParam, animeTitleParam, epNumParam]);
  // Apply the host's play/pause without the client guard (the guard blocks the
  // user's OWN controls, not the host-driven sync).
  const applyPartyPaused = useCallback((paused: boolean) => {
    try { paused ? player.pause() : player.play(); } catch {}
    setIsPlayerPaused(paused);
  }, [player]);
  const party = useWatchPartySync({
    player,
    episode: episode ? decodeURIComponent(episode) : undefined,
    navParams: partyNavParams,
    paused: isPlayerPaused,
    applyPaused: applyPartyPaused,
    selfReady,
  });
  const isPartyClient = party.role === "client";
  useEffect(() => { partyClientRef.current = isPartyClient; }, [isPartyClient]);
  useEffect(() => { holdPlaybackRef.current = party.holdPlayback; }, [party.holdPlayback]);
  useEffect(() => { partyPulseRef.current = party.pulse; }, [party.pulse]);
  // Live mirror of the client's "host hasn't started yet" window so the
  // self-heal deadline can tell an INTENTIONAL hold apart from a dead stream.
  const waitingForHostRef = useRef(false);
  useEffect(() => { waitingForHostRef.current = party.waitingForHost; }, [party.waitingForHost]);
  // While the host gate is holding (each new episode until Start), surface the
  // panel so the host always sees the live roster + Start button — including
  // when they opened the episode after creating the room from the lobby.
  useEffect(() => {
    if (party.role === "host" && party.holdPlayback) setPartyPanelOpen(true);
  }, [party.role, party.holdPlayback]);

  useEffect(() => { setSelfReady(false); }, [episode]);

  // Report readiness to the room: flip selfReady once the current source has
  // buffered its start (native: duration/readyToPlay; embeds buffer internally,
  // so they count as ready once shown). A hard cap prevents an undetectable
  // buffer state from deadlocking the whole room on the host's gate.
  useEffect(() => {
    if (!party.code || selfReady) return;
    if (isWebView) { setSelfReady(true); return; }
    // ponytail: 25s ceiling so a stuck/undetectable resolve can't hang the room.
    const cap = setTimeout(() => setSelfReady(true), 25000);
    const iv = setInterval(() => {
      try {
        if (player.status === "readyToPlay" || player.duration > 0) {
          setSelfReady(true);
        }
      } catch {}
    }, 500);
    return () => { clearTimeout(cap); clearInterval(iv); };
  }, [party.code, selfReady, isWebView, player, episode]);
  const startParty = useCallback(() => {
    if (!user) return;
    createRoom(user).catch(() => {});
    setPartyPanelOpen(true);
  }, [user]);

  // Fetch AniSkip timestamps for the current episode. Gate on having SOME way
  // to identify the anime (title or anime URL): on mount both were empty, so
  // the lookup ran against the episode URL, failed, then ran AGAIN once the
  // scrape filled the title in. `duration` is intentionally not a dep — it
  // flips 0 → real once playback starts and must not re-trigger the lookup.
  useEffect(() => {
    if (!episode) return;
    const resolvedTitle = (animeTitleParam ? decodeURIComponent(animeTitleParam) : "") || animeTitle;
    if (!resolvedTitle && !animeHref) return;
    let cancelled = false;
    let epNum = paramEpNum;
    if (epNum == null) epNum = episodeNumberFromUrl(episode);
    const resolvedSlug = (animeParam ? decodeURIComponent(animeParam) : "") || animeHref || episode;

    getEpisodeSkipTimes({
      title: resolvedTitle,
      episodeNumber: epNum,
      slugOrUrl: resolvedSlug,
      durationSeconds: duration,
    }).then((res) => {
      if (!cancelled && res && res.found) {
        setSkipTimes(res);
      }
    }).catch(() => {});

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode, paramEpNum, animeTitleParam, animeTitle, animeParam, animeHref]);

  // Observe playback time to detect active OP/ED interval and handle auto-skip
  useEffect(() => {
    if (!isPlaying || !skipTimes || !skipTimes.found) {
      if (activeSkip) setActiveSkip(null);
      return;
    }

    const checkInterval = () => {
      let cur = 0;
      if (player) {
        try { cur = player.currentTime || 0; } catch {}
      } else if (isWebView) {
        cur = playbackPositionMsRef.current / 1000;
      }
      if (cur <= 0) return;

      const currentActive = activeSkipInterval(cur, skipTimes);
      if (currentActive) {
        if (autoSkipIntroRef.current) {
          if (!skippedIntervalsRef.current.has(currentActive.type)) {
            skippedIntervalsRef.current.add(currentActive.type);
            performSkip(currentActive);
          }
        } else {
          setActiveSkip((prev) => (prev?.type === currentActive.type ? prev : currentActive));
        }
      } else {
        setActiveSkip((prev) => (prev ? null : prev));
      }
    };

    checkInterval();
    const intervalTimer = setInterval(checkInterval, 500);
    return () => clearInterval(intervalTimer);
  }, [isPlaying, skipTimes, player, isWebView, performSkip, activeSkip]);

  // Poll player state every 500ms — ONLY while the controls are on screen.
  // The seek bar / time labels these values drive aren't rendered when the
  // chrome is hidden, so polling then just re-rendered the whole player twice
  // a second for nothing. Gating on controlsVisible means the common case
  // (watching with controls hidden) does no per-frame work here.
  useEffect(() => {
    if (!isPlaying || !player || !controlsVisible) return;
    const tick = () => {
      try {
        const ct = player.currentTime;
        const d = player.duration;
        if (d > 0) {
          setCurrentTime(ct);
          setDuration(d);
          setSeekValue(isSeeking ? seekValue : ct / d);
        }
        setBufferAhead(bufferAheadSeconds(ct, player.bufferedPosition));
        setIsBuffering(player.status === "loading");
      } catch {}
    };
    tick(); // refresh the seek bar the instant controls reappear
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, [isPlaying, player, isSeeking, seekValue, controlsVisible]);

  // Lightweight buffering watch while controls are hidden — the buffer spinner
  // still needs to appear mid-watch. setIsBuffering(false) on a steady stream
  // is a no-op (React bails on identical state), so this stays render-free
  // unless buffering actually flips.
  useEffect(() => {
    if (!isPlaying || !player || controlsVisible) return;
    const iv = setInterval(() => {
      try { setIsBuffering(player.status === "loading"); } catch {}
    }, 1000);
    return () => clearInterval(iv);
  }, [isPlaying, player, controlsVisible]);

  // Playback speed
  const cycleSpeed = useCallback(() => {
    setSpeedIdx((i) => (i + 1) % SPEEDS.length);
  }, []);
  useEffect(() => {
    if (!player) return;
    try { player.playbackRate = SPEEDS[speedIdx]; } catch {}
  }, [speedIdx, player, videoUrl]);

  // ── SLEEP TIMER ──
  // The chip cycles off → 15 → 30 → 45 → 60 → off. When the timer fires it
  // pauses whichever surface is playing (native player or embed WebView).
  const cycleSleepTimer = useCallback(() => {
    const next = nextSleepPreset(sleepPreset);
    if (next == null) {
      setSleepPreset(null);
      setSleepEndsAt(null);
      showToast(t.sleepTimerOff);
    } else {
      setSleepPreset(next);
      setSleepEndsAt(Date.now() + next * 60_000);
      setSleepMinutes(next);
      showToast(t.sleepTimerOn(next));
    }
  }, [sleepPreset, showToast]);

  useEffect(() => {
    if (sleepEndsAt == null) return;
    const fire = () => {
      try { player.pause(); } catch {}
      if (isWebView) {
        webViewRef.current?.injectJavaScript(`
          try{var v=document.querySelector('video');if(v)v.pause();}catch(e){}
          try{if(typeof jwplayer==='function'){jwplayer().pause();}}catch(e){}
          try{if(typeof videojs==='function'){videojs(document.querySelector('.video-js')).pause();}}catch(e){}
          true;
        `);
      }
      setIsPlayerPaused(true);
      setSleepPreset(null);
      setSleepEndsAt(null);
      showToast(t.sleepTimerEnded);
    };
    const delay = sleepEndsAt - Date.now();
    if (delay <= 0) { fire(); return; }
    const timeout = setTimeout(fire, delay);
    const labelTimer = setInterval(
      () => setSleepMinutes(sleepMinutesLeft(sleepEndsAt, Date.now())),
      30_000,
    );
    return () => { clearTimeout(timeout); clearInterval(labelTimer); };
  }, [sleepEndsAt, player, isWebView, showToast]);

  // ── SUBTITLES ──
  // Only anime4upcdn ships sidecar VTT tracks today. The button cycles through
  // all tracks, then off; a single-track server simply toggles on/off.
  const subtitleCount = active?.subtitles?.length ?? 0;
  const activeSubKey = active?.server.iframeUrl || "";
  // New server → first track again, but never re-enable subtitles the user
  // explicitly turned off.
  useEffect(() => { setSubtitleIdx((prev) => (prev < 0 ? -1 : 0)); }, [activeSubKey]);
  const cycleSubtitles = useCallback(() => {
    const tracks = active?.subtitles || [];
    if (tracks.length === 0) return;
    const next = cycleSubtitleTrack(subtitleIdx, tracks.length);
    setSubtitleIdx(next);
    if (next < 0) {
      showToast(t.subtitleOff);
    } else {
      const track = tracks[next];
      showToast(t.subtitleOn(track?.label || track?.lang || t.subtitleTrack(next + 1)));
    }
  }, [active, subtitleIdx, showToast]);

  // Pausing must also freeze the hidden prefetch download.
  useEffect(() => {
    if (isPlayerPaused) stopPrefetch();
  }, [isPlayerPaused]);

  const enterPip = useCallback(() => {
    videoViewRef.current?.startPictureInPicture().catch(() => setPipSupported(false));
  }, []);

  const togglePlayPause = useCallback(() => {
    if (partyClientRef.current) { partyPulseRef.current(isPlayerPaused); return; }
    // Party host: can't start the episode until the whole room is ready.
    if (holdPlaybackRef.current && isPlayerPaused) return;
    if (!player) return;
    try {
      if (isPlayerPaused) {
        player.play();
        setIsPlayerPaused(false);
        partyPulseRef.current(true); // host: viewers resume in the same instant
      } else {
        player.pause();
        setIsPlayerPaused(true);
        partyPulseRef.current(false);
      }
    } catch {}
  }, [player, isPlayerPaused]);

  const seekBarRef = useRef<View>(null);

  // ── LIVE SCRUBBING ──
  // Drag the seek bar to scrub: the video seeks live as the thumb moves (the
  // frame updates under your finger) with a time-preview bubble. A plain tap
  // still jumps to that position (handled as a zero-movement drag). Because the
  // PanResponder is created once, every value it touches is read through a ref.
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const durationRef = useRef(0);
  const isPausedRef = useRef(false);
  const playerRef = useRef(player);
  durationRef.current = duration;
  isPausedRef.current = isPlayerPaused;
  playerRef.current = player;

  const seekBarWidthRef = useRef(0);
  const seekBarPageXRef = useRef(0);
  const lastLiveSeekRef = useRef(0);

  // Apply a scrub at `ratio` (0..1). `live` throttles the native seek so a fast
  // drag doesn't flood the player; `final` forces the seek and resumes play.
  const doScrub = useCallback((ratio: number, live: boolean, final: boolean) => {
    if (partyClientRef.current) return; // host controls seeking in a party
    const dur = durationRef.current;
    if (dur <= 0) return;
    const tt = ratio * dur;
    setSeekValue(ratio);
    setCurrentTime(tt);
    const p = playerRef.current;
    if (!p) return;
    const now = Date.now();
    if (final || !live || now - lastLiveSeekRef.current > 90) {
      lastLiveSeekRef.current = now;
      try { p.currentTime = tt; } catch {}
    }
    if (final && !isPausedRef.current) { try { p.play(); } catch {} }
    if (final) partyPulseRef.current(); // host: broadcast the scrubbed position
  }, []);

  const seekPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        setIsSeeking(true);
        if (hideTimer.current) clearTimeout(hideTimer.current);
        seekBarRef.current?.measureInWindow((x, _y, w) => {
          seekBarPageXRef.current = x;
          if (w > 0) seekBarWidthRef.current = w;
        });
        const w = seekBarWidthRef.current || 1;
        doScrub(clamp01(e.nativeEvent.locationX / w), false, false);
      },
      onPanResponderMove: (e) => {
        const w = seekBarWidthRef.current || 1;
        doScrub(clamp01((e.nativeEvent.pageX - seekBarPageXRef.current) / w), true, false);
      },
      onPanResponderRelease: (e) => {
        const w = seekBarWidthRef.current || 1;
        doScrub(clamp01((e.nativeEvent.pageX - seekBarPageXRef.current) / w), false, true);
        setIsSeeking(false);
        scheduleHideRef.current?.();
      },
      onPanResponderTerminate: () => {
        setIsSeeking(false);
        scheduleHideRef.current?.();
      },
    }),
  ).current;

  // ── BRIGHTNESS (swipe up/down) ──
  // expo-brightness is a native module that can't be added over OTA, so we dim
  // with a black overlay instead: swipe up = brighter (less overlay), swipe
  // down = dimmer. Vertical-dominant drags adjust brightness; a tap toggles the
  // chrome. Created once → reads brightness/handlers through refs.
  const [brightness, setBrightness] = useState(1); // 0.15..1, 1 = no dim
  const [brightnessActive, setBrightnessActive] = useState(false);
  const brightnessRef = useRef(1);
  brightnessRef.current = brightness;
  const brightnessStartRef = useRef(1);
  const brightnessHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapToToggleRef = useRef<() => void>(() => {});
  const scheduleHideRef = useRef<() => void>(() => {});

  const brightnessPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => {
        brightnessStartRef.current = brightnessRef.current;
      },
      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dy) <= Math.abs(g.dx)) return;
        const h = Dimensions.get("window").height || 1;
        const next = Math.max(0.15, Math.min(1, brightnessStartRef.current - g.dy / h));
        brightnessRef.current = next;
        setBrightness(next);
        setBrightnessActive(true);
        if (brightnessHideTimer.current) clearTimeout(brightnessHideTimer.current);
      },
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) {
          tapToToggleRef.current?.();
          return;
        }
        if (brightnessHideTimer.current) clearTimeout(brightnessHideTimer.current);
        brightnessHideTimer.current = setTimeout(() => setBrightnessActive(false), 700);
      },
    }),
  ).current;
  useEffect(() => () => { if (brightnessHideTimer.current) clearTimeout(brightnessHideTimer.current); }, []);

  // Format time helper
  const fmtTime = (s: number) => {
    if (s <= 0 || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // WebView ref for seeking
  const webViewRef = useRef<any>(null);

  // For native player: tapping the video itself toggles expo-video's native controls.
  // We MUST NOT wrap VideoView in a Pressable that intercepts taps — it kills native controls.
  // For WebView/loading/error states: a transparent overlay handles tap-to-show-controls.
  // IMPORTANT: must be declared BEFORE any conditional early-return so hook order stays stable.
  const tapToToggle = useCallback(() => {
    if (pickerOpen || episodesOpen || companionOpen) return;
    if (controlsVisible) {
      setControlsVisible(false);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    } else {
      showControls();
    }
  }, [pickerOpen, episodesOpen, companionOpen, controlsVisible, showControls]);

  // Keep the once-created PanResponders pointed at the latest callbacks.
  tapToToggleRef.current = tapToToggle;
  scheduleHideRef.current = scheduleHide;

  // ── DOWNLOAD (offline) ──
  // Live download state for the CURRENT episode, so the top-bar button can show
  // idle / progress / done and tapping it starts a save or opens the manager.
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus | null>(null);
  const [downloadPct, setDownloadPct] = useState(0);
  const [dlPicker, setDlPicker] = useState<DownloadMeta | null>(null);
  useEffect(() => {
    if (localUri || !episode) { setDownloadStatus(null); return; }
    const href = decodeURIComponent(episode);
    let alive = true;
    const sync = () =>
      getDownloadByEpisode(href).then((d) => {
        if (!alive) return;
        setDownloadStatus(d ? d.status : null);
        setDownloadPct(d ? Math.round((d.progress || 0) * 100) : 0);
      });
    sync();
    const unsub = subscribeDownloads(sync);
    return () => { alive = false; unsub(); };
  }, [episode, localUri]);

  const onDownload = useCallback(() => {
    if (!episode) return;
    // Already saved or in flight → jump to the Downloads manager.
    if (downloadStatus === "completed" || downloadStatus === "downloading" || downloadStatus === "resolving") {
      router.push("/downloads");
      return;
    }
    setDlPicker({
      animeTitle: animeTitle || (animeTitleParam ? decodeURIComponent(animeTitleParam) : ""),
      episodeTitle: title || "",
      epNum: paramEpNum,
      image: imgParam ? decodeURIComponent(imgParam) : "",
      animeHref: animeParam ? decodeURIComponent(animeParam) : animeHref,
      episodeHref: decodeURIComponent(episode),
      url4up: url4up ? decodeURIComponent(url4up) : undefined,
      url3rb: url3rb ? decodeURIComponent(url3rb) : undefined,
    });
  }, [episode, downloadStatus, animeTitle, animeTitleParam, title, paramEpNum, imgParam, animeParam, animeHref, url4up, url3rb]);

  const renderDownloadBtn = () => {
    if (localUri) return null; // already offline
    const inFlight = downloadStatus === "downloading" || downloadStatus === "resolving";
    const done = downloadStatus === "completed";
    return (
      <Pressable onPress={onDownload} style={ss.iconBtn} hitSlop={6}>
        {downloadStatus === "downloading" ? (
          <Text style={ss.speedBtnText}>{downloadPct}%</Text>
        ) : (
          <Ionicons
            name={done ? "checkmark-circle" : inFlight ? "cloud-download" : "download-outline"}
            size={18}
            color={done ? C.success : C.white}
          />
        )}
      </Pressable>
    );
  };

  // Watch Party button — ember-tinted when in a room, with a member-count badge.
  const renderPartyBtn = () => {
    if (localUri) return null; // offline file can't be shared live
    return (
      <Pressable
        onPress={() => (party.role ? setPartyPanelOpen((o) => !o) : startParty())}
        style={ss.iconBtn}
        hitSlop={6}
      >
        <Ionicons name="people" size={18} color={party.role ? C.accent : C.white} />
        {party.members.length > 1 && (
          <View style={ss.partyCount}>
            <Text style={ss.partyCountText}>{party.members.length}</Text>
          </View>
        )}
      </Pressable>
    );
  };

  // ── RENDER ──

  if (loading) {
    return (
      <View style={ss.root}>
        <StatusBar hidden />
        <View style={ss.centered}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={ss.statusText}>{t.loadingServers}</Text>
        </View>
      </View>
    );
  }

  // Primary source had no servers yet, but the anime3rb / anime4up fallbacks
  // are still being tried — keep the loader up instead of flashing the error.
  if (servers.length === 0 && !error && !noServersFinal) {
    return (
      <View style={ss.root}>
        <StatusBar hidden />
        <View style={ss.centered}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={ss.statusText}>{t.loadingServers}</Text>
        </View>
      </View>
    );
  }

  if (error || servers.length === 0) {
    return (
      <View style={ss.root}>
        <StatusBar hidden />
        <View style={ss.centered}>
          <Ionicons name="alert-circle" size={44} color={C.textMuted} />
          <Text style={ss.errorTitle}>{error ?? t.noServersFound}</Text>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
            <Pressable onPress={() => { void loadServers(); }} style={ss.actionBtn}>
              <Ionicons name="refresh" size={16} color={C.white} />
              <Text style={ss.actionBtnText}>{t.retry}</Text>
            </Pressable>
            <Pressable onPress={() => router.back()} style={[ss.actionBtn, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
              <Text style={ss.actionBtnText}>{t.goBack}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // ── SERVER SELECTION (shown before playback starts) ──
  // Fresh taps land here first: anime3rb servers are surfaced as "recommended"
  // at the top, then the rest, each group ordered by quality (FHD → HD → SD).
  // Picking one resolves + plays it directly.
  if (!picked) {
    const recRows = orderedServers.filter((x) => x.s.server.source === "anime3rb");
    const otherRows = orderedServers.filter((x) => x.s.server.source !== "anime3rb");
    const renderRow = ({ s, orig }: { s: ServerState; orig: number }) => {
      const recommended = s.server.source === "anime3rb";
      const q = qualityLabel(s.server.name);
      const initial = (getDisplayName(s.server).charAt(0) || "S").toUpperCase();
      return (
        <Pressable
          key={`${s.server.id}-${orig}`}
          onPress={() => pickServer(orig)}
          style={({ pressed }) => [ss.selItem, recommended && ss.selItemRec, pressed && { opacity: 0.7 }]}
        >
          <View style={[ss.serverAvatar, recommended && { borderColor: C.accent }]}>
            <Text style={[ss.serverAvatarText, recommended && { color: C.accent }]}>{initial}</Text>
          </View>
          <View style={ss.serverInfo}>
            <Text style={[ss.serverName, recommended && ss.serverNameActive]} numberOfLines={1}>
              {getDisplayName(s.server)}
            </Text>
            <Text style={ss.serverMeta} numberOfLines={1}>{s.server.source || t.tapToPlay}</Text>
          </View>
          {q ? (
            <View style={[ss.qualityBadge, q === "FHD" && ss.qualityBadgeHi]}>
              <Text style={[ss.qualityBadgeText, q === "FHD" && { color: C.accent }]}>{q}</Text>
            </View>
          ) : null}
          <Ionicons name="play-circle" size={24} color={recommended ? C.accent : "rgba(255,255,255,0.55)"} />
        </Pressable>
      );
    };
    return (
      <View style={ss.root}>
        <StatusBar hidden />
        <View style={[ss.selHeader, { paddingTop: (insets.top || 10) + 8 }]}>
          <Pressable onPress={() => router.back()} style={ss.iconBtn} hitSlop={6}>
            <Ionicons name="chevron-back" size={22} color={C.white} />
          </Pressable>
          <View style={ss.serverInfo}>
            <Text style={ss.selTitle} numberOfLines={1}>{t.chooseServerTitle}</Text>
            <Text style={ss.selSub} numberOfLines={1}>{title || animeTitle || t.chooseServerSub}</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={ss.selContent} showsVerticalScrollIndicator={false}>
          {recRows.length > 0 && <Text style={ss.selSectionLabel}>{t.serverRecommended}</Text>}
          {recRows.map(renderRow)}
          {otherRows.length > 0 && <Text style={ss.selSectionLabel}>{t.serverOthers}</Text>}
          {otherRows.map(renderRow)}
          {!noServersFinal && (
            <View style={ss.selFinding} accessibilityRole="progressbar" accessibilityLabel={t.findingServers}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={ss.selFindingText}>{t.findingServers}</Text>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  const allFailed = servers.every((s) => s.status === "failed");

  return (
    <View style={ss.root}>
      <StatusBar hidden />

      {/* Custom Player */}
      {isPlaying ? (
        <Pressable onPress={showControls} style={ss.playerWrap}>
          <VideoView
            ref={videoViewRef}
            player={player}
            style={ss.player}
            nativeControls={false}
            contentFit={videoFit}
            allowsPictureInPicture
          />
          <SubtitleOverlay
            tracks={active?.subtitles}
            selected={subtitleIdx}
            player={player}
            playing={isPlaying}
          />
        </Pressable>
      ) : isWebView ? (
        /* WEBVIEW FALLBACK */
        <WebView
          ref={webViewRef}
          key={`wv-${activeIdx}-${active?.server.id}`}
          source={{ uri: iframeUrl }}
          style={ss.player}
          allowsFullscreenVideo
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowsInlineMediaPlayback
          setSupportMultipleWindows={false}
          originWhitelist={["https://*", "http://*"]}
          injectedJavaScript={ADBLOCK_JS + webViewResumeScript(serverStartPositionMs) + PROGRESS_JS}
          onMessage={onWebViewProgress}
          startInLoadingState
          renderLoading={() => (
            <View style={[ss.player, ss.centered]}>
              <ActivityIndicator size="large" color={C.accent} />
              <Text style={ss.statusSub}>{t.loadingPlayer}</Text>
            </View>
          )}
          onShouldStartLoadWithRequest={(req) => {
            const u = req.url.toLowerCase();
            if (u.startsWith("intent://") || u.startsWith("market://")) return false;
            if (u.includes("pyppo") || u.includes("popads") || u.includes("doubleclick") || u.includes("trafficjunky") || u.includes("popcash") || u.includes("propeller") || u.includes("exoclick") || u.includes("adnxs") || u.includes("taboola") || u.includes("outbrain") || u.includes("adservice") || u.includes("medixiru") || u.includes("playnixes")) return false;
            // Allow sub-resources (scripts, images, etc.) from any domain
            if (!req.isTopFrame) return true;
            // Top-level: only allow embed domain + video files
            const embedOrigin = new URL(iframeUrl).origin.toLowerCase();
            if (u.startsWith(embedOrigin)) return true;
            // Current WitAnime gates are session-bound 302s to the selected
            // provider. Allow that non-ad redirect chain to leave witanime.site.
            if (/witanime\.site\/watch\/stream-gate\//i.test(iframeUrl) && /^https?:\/\//.test(u)) return true;
            if (u.includes(".m3u8") || u.includes(".mp4")) return true;
            return false;
          }}
          onOpenWindow={() => {}}
          onHttpError={() => {
            setServers((p) => p.map((s, i) => i === activeIdx ? { ...s, status: "failed" } : s));
          }}
          onError={() => {
            setServers((p) => p.map((s, i) => i === activeIdx ? { ...s, status: "failed" } : s));
          }}
        />
      ) : active?.status === "resolving" ? (
        <View style={[ss.player, ss.centered]}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={ss.statusText}>{t.connecting}</Text>
          <Text style={ss.statusSub}>{active ? getDisplayName(active.server) : ""}</Text>
        </View>
      ) : allFailed ? (
        <View style={[ss.player, ss.centered]}>
          <Ionicons name="cloud-offline-outline" size={48} color={C.textMuted} />
          <Text style={ss.statusText}>{t.allServersFailed}</Text>
          <Pressable onPress={() => { void loadServers(); }} style={ss.actionBtn}>
            <Ionicons name="refresh" size={16} color={C.textOnAccent} />
            <Text style={ss.actionBtnText}>{t.retry}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[ss.player, ss.centered]}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={ss.statusText}>{t.resolving}</Text>
        </View>
      )}

      {/* Transparent tap-catcher ONLY when WebView is active or controls hidden in non-native states.
          Skipped during native playback so taps reach expo-video's native controls. */}
      {!isPlaying && !pickerOpen && !episodesOpen && !companionOpen && (
        <Pressable
          style={[ABSOLUTE_FILL, { zIndex: 1 }]}
          onPress={tapToToggle}
          pointerEvents={isWebView && controlsVisible ? 'box-none' : 'auto'}
        />
      )}

      {/* Full-screen tap zone during native playback — when our chrome is
          hidden, tapping ANYWHERE shows it (like YouTube / Netflix). Once
          the chrome is visible we remove this overlay so taps reach
          expo-video's native controls. */}
      {isPlaying && !pickerOpen && !episodesOpen && !companionOpen && !controlsVisible && !locked && (
        <View
          style={[ABSOLUTE_FILL, { zIndex: 2 }]}
          {...brightnessPan.panHandlers}
        />
      )}

      {/* LOCKED: every gesture is dead except this floating unlock button. A
          tap anywhere reveals it (auto-hides with the chrome timer); tapping it
          lifts the lock and restores the normal controls. */}
      {isPlaying && locked && (
        <Pressable style={[ABSOLUTE_FILL, { zIndex: 7 }]} onPress={showControls}>
          {controlsVisible && (
            <View style={ss.lockLayer} pointerEvents="box-none">
              <Pressable
                onPress={() => { setLocked(false); showControls(); }}
                style={ss.lockBtn}
                hitSlop={12}
              >
                <Ionicons name="lock-closed" size={22} color={C.white} />
                <Text style={ss.lockBtnText}>{t.unlock}</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      )}

      {/* Buffering spinner — floats above the video even when chrome is hidden */}
      {isPlaying && isBuffering && !controlsVisible && (
        <View style={ss.bufferOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={C.accent} />
        </View>
      )}

      {/* Party client held by the host's start gate: the video is paused on
          purpose and local controls are suppressed — without this pill the
          joiner just saw a dead player ("loading forever, won't play"). */}
      {isPartyClient && party.waitingForHost && isPlaying && isPlayerPaused && (
        <View style={ss.partyWaitPill} pointerEvents="none">
          <ActivityIndicator size="small" color={C.accent} />
          <Text style={ss.partyWaitText}>{t.wpWaitingToStart}</Text>
        </View>
      )}

      {/* Smart skip — floating pill while an OP/ED interval is active (manual
          mode only: auto-skip seeks inside performSkip, so activeSkip never
          gets set). Hidden for party clients (host drives) and locked screens. */}
      {isPlaying && activeSkip && !locked && !isPartyClient && (
        <Pressable onPress={() => performSkip(activeSkip)} style={ss.skipPill} hitSlop={8}>
          <Ionicons name="play-forward" size={15} color={C.textOnAccent} />
          <Text style={ss.skipPillText}>
            {activeSkip.type === "op" ? t.skipIntro : t.skipOutro}
          </Text>
        </Pressable>
      )}

      {/* HUD toast — skip feedback ("تم تخطّي المقدمة") for auto-skip + taps */}
      {toastText != null && (
        <Animated.View style={[ss.toast, { opacity: toastOpacity }]} pointerEvents="none">
          <Text style={ss.toastText}>{toastText}</Text>
        </Animated.View>
      )}

      {/* Next-episode countdown — shown at ≥97% instead of hopping instantly.
          Party clients never see it (the host drives episode changes). */}
      {(isPlaying || isWebView) && nextCountdown != null && !isPartyClient && !locked && nextEpisodeHref && (
        <View style={ss.nextOverlay} pointerEvents="box-none">
          <View style={ss.nextCard}>
            <View style={ss.nextTimer}>
              <Text style={ss.nextTimerText}>{nextCountdown}</Text>
            </View>
            <View style={ss.nextTextCol}>
              <Text style={ss.nextLabel}>{t.nextEpisode}</Text>
              <Text style={ss.nextHint}>{t.autoplayNextIn(nextCountdown)}</Text>
            </View>
            <Pressable
              onPress={() => { setNextCountdown(null); goNextEpisode(true); }}
              style={ss.chipBtnAccent}
              hitSlop={6}
            >
              <Text style={ss.chipBtnAccentText}>{t.watchNow}</Text>
            </Pressable>
            <Pressable onPress={() => setNextCountdown(null)} style={ss.chipBtn} hitSlop={6}>
              <Ionicons name="close" size={16} color={C.white} />
            </Pressable>
          </View>
        </View>
      )}

      {/* Custom Controls Overlay */}
      {isPlaying && !pickerOpen && !episodesOpen && !companionOpen && controlsVisible && !locked && (
        <View style={ss.controlsOverlay} pointerEvents="box-none">
          {/* Tap on empty space hides the chrome; vertical swipe adjusts brightness */}
          <View style={ABSOLUTE_FILL} {...brightnessPan.panHandlers} />
          <LinearGradient
            colors={["rgba(0,0,0,0.8)", "rgba(0,0,0,0.35)", "transparent"]}
            style={ss.gradTop}
            pointerEvents="none"
          />
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.45)", "rgba(0,0,0,0.9)"]}
            style={ss.gradBottom}
            pointerEvents="none"
          />

          {/* Top: back + titles + actions */}
          <View style={[ss.ctrlTopBar, { paddingTop: (insets.top || 10) + 6 }]} pointerEvents="box-none">
            <Pressable onPress={() => router.back()} style={ss.iconBtn} hitSlop={6}>
              <Ionicons name="chevron-back" size={22} color={C.white} />
            </Pressable>
            <View style={ss.titleArea}>
              <Text style={ss.titleText} numberOfLines={1}>{displayTitle}</Text>
              {active && (
                <View style={ss.metaRow}>
                  <View style={ss.directPill}>
                    <View style={ss.liveDot} />
                    <Text style={ss.directPillText}>DIRECT</Text>
                  </View>
                  <Text style={ss.serverLabelText} numberOfLines={1}>
                    {getDisplayName(active.server)}{bufferAhead != null ? ` · ${Math.round(bufferAhead)}s buffer` : ""}
                  </Text>
                </View>
              )}
            </View>
            <Pressable onPress={goToAnimePage} style={ss.iconBtn} hitSlop={6}>
              <Ionicons name="information-circle-outline" size={20} color={C.white} />
            </Pressable>
            <Pressable
              onPress={() => { setLocked(true); setControlsVisible(false); if (hideTimer.current) clearTimeout(hideTimer.current); }}
              style={ss.iconBtn}
              hitSlop={6}
            >
              <Ionicons name="lock-open-outline" size={18} color={C.white} />
            </Pressable>
            <Pressable onPress={cycleSpeed} style={ss.speedBtn} hitSlop={6}>
              <Text style={ss.speedBtnText}>{SPEEDS[speedIdx]}x</Text>
            </Pressable>
            <Pressable
              onPress={() => setVideoFit((f) => (f === "contain" ? "fill" : "contain"))}
              style={ss.iconBtn}
              hitSlop={6}
            >
              <Ionicons
                name={videoFit === "contain" ? "expand-outline" : "contract-outline"}
                size={18}
                color={C.white}
              />
            </Pressable>
            {pipSupported && (
              <Pressable onPress={enterPip} style={ss.iconBtn} hitSlop={6} accessibilityLabel={t.pip}>
                <Ionicons name="duplicate-outline" size={18} color={C.white} />
              </Pressable>
            )}
            {subtitleCount > 0 && (
              <Pressable
                onPress={cycleSubtitles}
                style={[ss.iconBtn, subtitleIdx >= 0 && ss.iconBtnAccent]}
                hitSlop={6}
                accessibilityLabel={t.subtitlesLabel}
              >
                <Ionicons
                  name={subtitleIdx >= 0 ? "text" : "text-outline"}
                  size={18}
                  color={subtitleIdx >= 0 ? C.accent : C.white}
                />
              </Pressable>
            )}
            {companionEpNum != null && (
              <Pressable
                onPress={openCompanion}
                style={[ss.iconBtn, companionOpen && ss.iconBtnAccent]}
                hitSlop={6}
                accessibilityLabel={t.companion}
              >
                <Ionicons name="sparkles-outline" size={18} color={companionOpen ? C.accent : C.white} />
              </Pressable>
            )}
            {renderDownloadBtn()}
            {renderPartyBtn()}
            <Pressable onPress={() => setPickerOpen(true)} style={ss.iconBtn} hitSlop={6}>
              <Ionicons name="server-outline" size={18} color={C.white} />
            </Pressable>
          </View>

          {/* Center: skip back / play / skip forward */}
          <View style={ss.centerCluster} pointerEvents="box-none">
            <Pressable onPress={skipBack} style={ss.skipBtn} hitSlop={8}>
              <Ionicons name="play-back" size={24} color={C.white} />
              <Text style={ss.skipLabel}>10</Text>
            </Pressable>
            <Pressable onPress={togglePlayPause} style={ss.playBtn} hitSlop={8}>
              {isBuffering && !isPlayerPaused ? (
                <ActivityIndicator size="large" color={C.textOnAccent} />
              ) : (
                <Ionicons
                  name={isPlayerPaused ? "play" : "pause"}
                  size={38}
                  color={C.textOnAccent}
                  style={isPlayerPaused ? { marginLeft: 4 } : undefined}
                />
              )}
            </Pressable>
            <Pressable onPress={skipForward} style={ss.skipBtn} hitSlop={8}>
              <Ionicons name="play-forward" size={24} color={C.white} />
              <Text style={ss.skipLabel}>10</Text>
            </Pressable>
          </View>

          {/* Bottom: seek bar + chips */}
          <View style={[ss.ctrlBottom, { paddingBottom: (insets.bottom || 10) + 8 }]} pointerEvents="box-none">
            <View style={ss.seekRow}>
              <Text style={ss.timeText}>{fmtTime(currentTime)}</Text>
              <View
                ref={seekBarRef}
                style={ss.seekBarWrap}
                collapsable={false}
                onLayout={(e) => { seekBarWidthRef.current = e.nativeEvent.layout.width; }}
              >
                <View style={[ss.seekTrack, isSeeking && ss.seekTrackActive]}>
                  <View style={[ss.seekFill, { width: `${Math.min(seekValue * 100, 100)}%` }]} />
                </View>
                {isSeeking && (
                  <View
                    style={[ss.seekBubble, { left: `${Math.min(seekValue * 100, 100)}%` }]}
                    pointerEvents="none"
                  >
                    <Text style={ss.seekBubbleText}>{fmtTime(seekValue * duration)}</Text>
                  </View>
                )}
                <View
                  style={[
                    ss.seekThumb,
                    { left: `${Math.min(seekValue * 100, 100)}%` },
                    isSeeking && ss.seekThumbActive,
                  ]}
                  pointerEvents="none"
                />
                <View style={ss.seekTouchArea} {...seekPan.panHandlers} />
              </View>
              <Text style={ss.timeTextDur}>{fmtTime(duration)}</Text>
            </View>

            <View style={ss.ctrlRow}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={skipForward85} style={ss.chipBtn}>
                  <Ionicons name="play-forward-circle-outline" size={16} color={C.white} />
                  <Text style={ss.chipBtnText}>{t.skip85s}</Text>
                </Pressable>
                {!isPartyClient && (
                  <Pressable
                    onPress={cycleSleepTimer}
                    style={[ss.chipBtn, sleepEndsAt != null && ss.chipBtnActive]}
                    accessibilityLabel={t.sleepTimerShort(sleepMinutes)}
                  >
                    <Ionicons name="moon-outline" size={15} color={sleepEndsAt != null ? C.accent : C.white} />
                    {sleepEndsAt != null && (
                      <Text style={[ss.chipBtnText, { color: C.accent }]}>{t.sleepTimerShort(sleepMinutes)}</Text>
                    )}
                  </Pressable>
                )}
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                {!isPartyClient && (
                  <Pressable onPress={openEpisodes} style={ss.chipBtn}>
                    <Ionicons name="list-outline" size={15} color={C.white} />
                    <Text style={ss.chipBtnText}>{t.episodes}</Text>
                  </Pressable>
                )}
                {prevEpisodeHref && (
                  <Pressable onPress={goPrevEpisode} style={ss.chipBtn}>
                    <Ionicons name="play-skip-back" size={14} color={C.white} />
                    <Text style={ss.chipBtnText}>{t.prevEpisode}</Text>
                  </Pressable>
                )}
                {nextEpisodeHref && (
                  <Pressable onPress={() => goNextEpisode()} style={ss.chipBtnAccent}>
                    <Text style={ss.chipBtnAccentText}>{t.nextEpisode}</Text>
                    <Ionicons name="play-skip-forward" size={14} color={C.textOnAccent} />
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </View>
      )}

      {/* TOP BAR for non-native states (WebView, loading) */}
      {controlsVisible && !pickerOpen && !episodesOpen && !companionOpen && !isPlaying && (
        <View style={ss.overlay} pointerEvents="box-none">
          <View style={[ss.ctrlTopBar, { paddingTop: (insets.top || 10) + 6 }]}>
            <LinearGradient
              colors={["rgba(0,0,0,0.85)", "rgba(0,0,0,0.4)", "transparent"]}
              style={ss.topBarGrad}
              pointerEvents="none"
            />
            <Pressable onPress={() => router.back()} style={ss.iconBtn} hitSlop={6}>
              <Ionicons name="chevron-back" size={22} color={C.white} />
            </Pressable>
            <View style={ss.titleArea}>
              <Text style={ss.titleText} numberOfLines={1}>{displayTitle}</Text>
              {active && (
                <View style={ss.metaRow}>
                  {isWebView && (
                    <View style={[ss.directPill, { backgroundColor: "rgba(0,212,255,0.18)", borderColor: "rgba(0,212,255,0.35)" }]}>
                      <Text style={[ss.directPillText, { color: C.cyan }]}>EMBED</Text>
                    </View>
                  )}
                  <Text style={ss.serverLabelText} numberOfLines={1}>
                    {getDisplayName(active.server)}
                  </Text>
                </View>
              )}
            </View>
            <Pressable onPress={goToAnimePage} style={ss.iconBtn} hitSlop={6}>
              <Ionicons name="information-circle-outline" size={20} color={C.white} />
            </Pressable>
            {!isPartyClient && (
              <>
                <Pressable onPress={openEpisodes} style={ss.iconBtn} hitSlop={6}>
                  <Ionicons name="list-outline" size={18} color={C.white} />
                </Pressable>
                <Pressable
                  onPress={cycleSleepTimer}
                  style={[ss.iconBtn, sleepEndsAt != null && ss.iconBtnAccent]}
                  hitSlop={6}
                  accessibilityLabel={t.sleepTimerShort(sleepMinutes)}
                >
                  <Ionicons name="moon-outline" size={18} color={sleepEndsAt != null ? C.accent : C.white} />
                </Pressable>
                {companionEpNum != null && (
                  <Pressable
                    onPress={openCompanion}
                    style={[ss.iconBtn, companionOpen && ss.iconBtnAccent]}
                    hitSlop={6}
                    accessibilityLabel={t.companion}
                  >
                    <Ionicons name="sparkles-outline" size={18} color={companionOpen ? C.accent : C.white} />
                  </Pressable>
                )}
              </>
            )}
            <Pressable onPress={skipForward} style={ss.iconBtn} hitSlop={6}>
              <Ionicons name="play-forward" size={18} color={C.white} />
            </Pressable>
            {nextEpisodeHref && (
              <Pressable onPress={() => goNextEpisode()} style={[ss.iconBtn, ss.iconBtnAccent]} hitSlop={6}>
                <Ionicons name="play-skip-forward" size={18} color={C.white} />
              </Pressable>
            )}
            {renderDownloadBtn()}
            {renderPartyBtn()}
            <Pressable onPress={() => setPickerOpen(true)} style={ss.iconBtn} hitSlop={6}>
              <Ionicons name="server-outline" size={18} color={C.white} />
            </Pressable>
          </View>
        </View>
      )}

      {/* WATCH PARTY panel — non-intrusive room overlay (live roster + start gate).
          Rendered once at root so it shows over either player surface. The host
          sees who's ready and presses Start only once everyone has resolved a
          source (no one stuck on a loading screen); viewers see their own state. */}
      {party.role && partyPanelOpen && (
        <View style={[ss.partyPanel, { top: (insets.top || 10) + 48 }]}>
          <View style={ss.partyHeadRow}>
            <View style={ss.partyLiveDot} />
            <Text style={ss.partyHeadText} numberOfLines={1}>
              {party.role === "host" ? `${t.wpPartyBtn} · ${party.code}` : t.wpFollowing}
            </Text>
            {party.viewerCount > 0 && (
              <View style={ss.partyReadyPill}>
                <Text style={ss.partyReadyPillText}>{t.wpReadyOf(party.readyCount, party.viewerCount)}</Text>
              </View>
            )}
          </View>

          <Text style={ss.partyStatus}>
            {isPartyClient
              ? (party.hostPaused ? t.wpWaitingToStart : t.wpHostPlaying)
              : (party.holdPlayback
                  ? (party.allReady ? t.wpAllReady : t.wpWaitingReady(party.waitingCount))
                  : t.wpHostPlaying)}
          </Text>

          {/* Live roster: one row per member with an explicit ready / loading
              state, so the host can read the room at a glance before starting. */}
          <View style={ss.partyRoster}>
            {party.members.slice(0, 6).map((m) => {
              // The host (leader) drives the room and is never gated on itself,
              // so it always reads as ready — never show the leader "waiting".
              const ready = m.isHost || m.ready;
              return (
                <View key={m.userId} style={ss.partyMember}>
                  <View style={[ss.partyMAvatar, m.isHost && ss.partyAvatarHost]}>
                    <Text style={ss.partyAvatarText}>{(m.name || "?").trim().charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={ss.partyMName} numberOfLines={1}>
                    {m.userId === user?.id ? t.wpYou : m.name}{m.isHost ? ` · ${t.wpHost}` : ""}
                  </Text>
                  {ready ? (
                    <View style={ss.partyChip}>
                      <Text style={ss.partyChipReady}>{t.wpReady}</Text>
                      <Ionicons name="checkmark-circle" size={12} color={C.success} />
                    </View>
                  ) : (
                    <View style={ss.partyChip}>
                      <Text style={ss.partyChipWait}>{t.wpBuffering}</Text>
                      <ActivityIndicator size="small" color={C.gold} />
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Host start gate: enabled once every viewer is ready, so the press
              starts everyone together with nothing still buffering. If a viewer
              never reports ready the gate would deadlock — after a hold the
              escape hatch (startAnywayAvailable) lets the host start anyway. */}
          {party.role === "host" && party.holdPlayback && (() => {
            const canStart = party.allReady || party.startAnywayAvailable;
            return (
              <Pressable
                disabled={!canStart}
                onPress={() => party.start()}
                style={[ss.partyStartBtn, !canStart && ss.partyStartBtnDisabled]}
              >
                {canStart ? (
                  <Ionicons name="play" size={15} color={C.black} />
                ) : (
                  <ActivityIndicator size="small" color={C.textMuted} />
                )}
                <Text style={[ss.partyStartTxt, !canStart && ss.partyStartTxtDisabled]}>
                  {party.allReady
                    ? t.wpStartForEveryone
                    : party.startAnywayAvailable
                      ? t.wpStartAnyway
                      : t.wpWaitingReady(party.waitingCount)}
                </Text>
              </Pressable>
            );
          })()}

          <Pressable style={ss.partyLeave} onPress={() => { party.leaveParty(); setPartyPanelOpen(false); }}>
            <Ionicons name="exit-outline" size={14} color={C.error} />
            <Text style={ss.partyLeaveText}>{t.wpLeaveParty}</Text>
          </Pressable>
        </View>
      )}

      {/* Brightness dim overlay — variable-opacity black scrim (no native module
          needed, so it ships over OTA). Never fully opaque so the video stays
          visible. pointerEvents none so it never eats gestures. */}
      {isPlaying && brightness < 1 && (
        <View
          pointerEvents="none"
          style={[ABSOLUTE_FILL, { backgroundColor: C.player, opacity: (1 - brightness) * 0.92, zIndex: 6 }]}
        />
      )}

      {/* Brightness level indicator (shown while swiping) */}
      {isPlaying && brightnessActive && (
        <View style={ss.brightnessIndicator} pointerEvents="none">
          <Ionicons name="sunny" size={22} color={C.white} />
          <View style={ss.brightnessBarTrack}>
            <View style={[ss.brightnessBarFill, { height: `${brightness * 100}%` }]} />
          </View>
          <Text style={ss.brightnessPct}>{Math.round(brightness * 100)}%</Text>
        </View>
      )}

      {/* SERVER PICKER — landscape side drawer, animated in/out */}
      {pickerOpen && (
        <ServerSheet
          servers={servers}
          activeIdx={activeIdx}
          refreshing={refreshing}
          insets={insets}
          onSelect={selectServer}
          onRefresh={refreshServers}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* EPISODE LIST — same landscape side drawer pattern as the servers */}
      {episodesOpen && (
        <EpisodeSheet
          episodes={epList}
          currentIdx={currentEpIdx}
          loading={epListLoading}
          insets={insets}
          onSelect={jumpToEpisode}
          onClose={() => setEpisodesOpen(false)}
        />
      )}

      {/* رفيق الأنمي — spoiler-safe AI companion drawer */}
      {companionOpen && companionEpNum != null && (
        <CompanionSheet
          title={(animeTitleParam ? decodeURIComponent(animeTitleParam) : "") || animeTitle || episodeLabel || t.companion}
          spoilerBound={companionEpNum}
          messages={companionMsgs}
          busy={companionBusy}
          input={companionInput}
          onChangeInput={setCompanionInput}
          onSend={() => sendCompanion("chat")}
          onRecap={() => sendCompanion("recap")}
          onClose={() => setCompanionOpen(false)}
          insets={insets}
        />
      )}
      <DownloadPicker visible={!!dlPicker} meta={dlPicker} onClose={() => setDlPicker(null)} />
    </View>
  );
}

/* ── Server picker — landscape side drawer with slide-in motion ──────
   Purely presentational: all playback logic (select/refresh/state) stays in
   WatchScreen and arrives as props. Slides in from the trailing edge with a
   backdrop fade; reduced-motion shows it instantly. RN core Animated only
   (Reanimated crashes over OTA). */
function ServerSheet({
  servers,
  activeIdx,
  refreshing,
  insets,
  onSelect,
  onRefresh,
  onClose,
}: {
  servers: ServerState[];
  activeIdx: number;
  refreshing: boolean;
  insets: { top: number };
  onSelect: (index: number) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const hideX = Dimensions.get("window").width;
  const slide = useRef(new Animated.Value(reduced ? 0 : 1)).current; // 1 = off-screen right
  const backdrop = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) return;
    Animated.parallel([
      Animated.timing(slide, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  const animateClose = () => {
    if (reduced) { onClose(); return; }
    Animated.parallel([
      Animated.timing(slide, { toValue: 1, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) onClose(); });
  };

  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [0, hideX] });

  return (
    <View style={ss.pickerOverlay}>
      <Animated.View style={[ss.pickerBackdrop, { opacity: backdrop }]}>
        <Pressable style={ABSOLUTE_FILL} onPress={animateClose} />
      </Animated.View>
      <Animated.View style={[ss.pickerSheet, { paddingTop: (insets.top || 10) + 10, transform: [{ translateX }] }]}>
        <View style={ss.pickerHeader}>
          <View style={ss.pickerHeaderLeft}>
            <View style={ss.pickerHeaderIcon}>
              <Ionicons name="server-outline" size={16} color={C.accent} />
            </View>
            <View>
              <Text style={ss.pickerTitle}>سيرفرات المشاهدة</Text>
              <Text style={ss.pickerSub}>
                {servers.filter((s) => s.status === "playing" || s.status === "webview").length} / {servers.length}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={onRefresh} style={ss.iconBtn} hitSlop={6} disabled={refreshing}>
              {refreshing ? (
                <ActivityIndicator size="small" color={C.accent} />
              ) : (
                <Ionicons name="refresh" size={18} color={C.white} />
              )}
            </Pressable>
            <Pressable onPress={animateClose} style={ss.iconBtn} hitSlop={6}>
              <Ionicons name="close" size={20} color={C.white} />
            </Pressable>
          </View>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} style={ss.pickerScroll} contentContainerStyle={ss.pickerContent}>
          {servers.map((item, index) => {
            const isActive = index === activeIdx;
            const color = item.status === "playing" ? C.success
              : item.status === "webview" ? C.cyan
              : item.status === "failed" ? C.error
              : item.status === "resolving" ? C.gold
              : C.textMuted;
            const label = item.status === "playing" ? "Direct"
              : item.status === "webview" ? "Embed"
              : item.status === "failed" ? "Failed"
              : item.status === "resolving" ? "Connecting…"
              : "Tap to play";
            const initial = (getDisplayName(item.server).charAt(0) || "S").toUpperCase();
            return (
              <Pressable
                key={`${item.server.id}-${index}`}
                onPress={() => onSelect(index)}
                style={({ pressed }) => [ss.serverItem, isActive && ss.serverItemActive, pressed && { opacity: 0.7 }]}
              >
                <View style={[ss.serverAvatar, isActive && { borderColor: C.accent }]}>
                  {item.status === "resolving" ? (
                    <ActivityIndicator size="small" color={C.gold} />
                  ) : (
                    <Text style={[ss.serverAvatarText, isActive && { color: C.accent }]}>{initial}</Text>
                  )}
                  <View style={[ss.serverStatusDot, { backgroundColor: color }]} />
                </View>
                <View style={ss.serverInfo}>
                  <Text style={[ss.serverName, isActive && ss.serverNameActive]} numberOfLines={1}>
                    {getDisplayName(item.server)}
                  </Text>
                  <View style={ss.serverMetaRow}>
                    <Text style={[ss.serverMetaLabel, { color }]}>{label}</Text>
                    {item.server.source ? (
                      <Text style={ss.serverMeta} numberOfLines={1}> • {item.server.source}</Text>
                    ) : null}
                  </View>
                </View>
                {isActive ? (
                  <View style={ss.activeBadge}>
                    <Ionicons name="play" size={9} color={C.textOnAccent} />
                    <Text style={ss.activeBadgeText}>NOW</Text>
                  </View>
                ) : item.status === "playing" ? (
                  <Ionicons name="flash" size={14} color={C.success} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/* ── Episode list — same landscape side drawer as ServerSheet ──────── */
function EpisodeSheet({
  episodes,
  currentIdx,
  loading,
  insets,
  onSelect,
  onClose,
}: {
  episodes: Episode[];
  currentIdx: number;
  loading: boolean;
  insets: { top: number };
  onSelect: (episode: Episode) => void;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const hideX = Dimensions.get("window").width;
  const slide = useRef(new Animated.Value(reduced ? 0 : 1)).current; // 1 = off-screen right
  const backdrop = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) return;
    Animated.parallel([
      Animated.timing(slide, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  const animateClose = () => {
    if (reduced) { onClose(); return; }
    Animated.parallel([
      Animated.timing(slide, { toValue: 1, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) onClose(); });
  };

  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [0, hideX] });

  return (
    <View style={ss.pickerOverlay}>
      <Animated.View style={[ss.pickerBackdrop, { opacity: backdrop }]}>
        <Pressable style={ABSOLUTE_FILL} onPress={animateClose} />
      </Animated.View>
      <Animated.View style={[ss.pickerSheet, { paddingTop: (insets.top || 10) + 10, transform: [{ translateX }] }]}>
        <View style={ss.pickerHeader}>
          <View style={ss.pickerHeaderLeft}>
            <View style={ss.pickerHeaderIcon}>
              <Ionicons name="list-outline" size={16} color={C.accent} />
            </View>
            <View>
              <Text style={ss.pickerTitle}>{t.episodes}</Text>
              <Text style={ss.pickerSub}>
                {episodes.length > 0 ? t.episodeCount(episodes.length) : ""}
              </Text>
            </View>
          </View>
          <Pressable onPress={animateClose} style={ss.iconBtn} hitSlop={6}>
            <Ionicons name="close" size={20} color={C.white} />
          </Pressable>
        </View>
        {loading && episodes.length === 0 ? (
          <View style={ss.selFinding}>
            <ActivityIndicator size="small" color={C.accent} />
            <Text style={ss.selFindingText}>{t.loading}</Text>
          </View>
        ) : episodes.length === 0 ? (
          <Text style={ss.emptyText}>{t.noEpisodes}</Text>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} style={ss.pickerScroll} contentContainerStyle={ss.pickerContent}>
            {episodes.map((ep, i) => {
              const isCurrent = i === currentIdx;
              const num = ep.number > 0 ? ep.number : i + 1;
              return (
                <Pressable
                  key={`${ep.href || "ep"}-${i}`}
                  disabled={!ep.href}
                  onPress={() => onSelect(ep)}
                  style={({ pressed }) => [
                    ss.serverItem,
                    isCurrent && ss.serverItemActive,
                    pressed && { opacity: 0.7 },
                    !ep.href && { opacity: 0.4 },
                  ]}
                >
                  <View style={[ss.serverAvatar, isCurrent && { borderColor: C.accent }]}>
                    <Text style={[ss.serverAvatarText, isCurrent && { color: C.accent }]}>{num}</Text>
                  </View>
                  <View style={ss.serverInfo}>
                    <Text style={[ss.serverName, isCurrent && ss.serverNameActive]} numberOfLines={1}>
                      {ep.title || `${t.episode} ${num}`}
                    </Text>
                  </View>
                  {isCurrent && (
                    <View style={ss.activeBadge}>
                      <Ionicons name="play" size={9} color={C.textOnAccent} />
                      <Text style={ss.activeBadgeText}>NOW</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}

/* ── رفيق الأنمي — spoiler-safe AI companion drawer ────────────────── */
function CompanionSheet({
  title,
  spoilerBound,
  messages,
  busy,
  input,
  onChangeInput,
  onSend,
  onRecap,
  onClose,
  insets,
}: {
  title: string;
  spoilerBound: number;
  messages: { role: "user" | "ai"; text: string }[];
  busy: boolean;
  input: string;
  onChangeInput: (v: string) => void;
  onSend: () => void;
  onRecap: () => void;
  onClose: () => void;
  insets: { top: number };
}) {
  const reduced = useReducedMotion();
  const hideX = Dimensions.get("window").width;
  const slide = useRef(new Animated.Value(reduced ? 0 : 1)).current; // 1 = off-screen right
  const backdrop = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) return;
    Animated.parallel([
      Animated.timing(slide, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  const animateClose = () => {
    if (reduced) { onClose(); return; }
    Animated.parallel([
      Animated.timing(slide, { toValue: 1, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) onClose(); });
  };

  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [0, hideX] });

  return (
    <View style={ss.pickerOverlay}>
      <Animated.View style={[ss.pickerBackdrop, { opacity: backdrop }]}>
        <Pressable style={ABSOLUTE_FILL} onPress={animateClose} />
      </Animated.View>
      <Animated.View style={[ss.pickerSheet, { paddingTop: (insets.top || 10) + 10, transform: [{ translateX }] }]}>
        <View style={ss.pickerHeader}>
          <View style={ss.pickerHeaderLeft}>
            <View style={ss.pickerHeaderIcon}>
              <Ionicons name="sparkles" size={16} color={C.accent} />
            </View>
            <View>
              <Text style={ss.pickerTitle}>{t.companion}</Text>
              <Text style={ss.pickerSub}>{t.companionSpoilerNote(spoilerBound)}</Text>
            </View>
          </View>
          <Pressable onPress={animateClose} style={ss.iconBtn} hitSlop={6}>
            <Ionicons name="close" size={20} color={C.white} />
          </Pressable>
        </View>

        <ScrollView
          style={ss.companionBody}
          contentContainerStyle={ss.companionMessages}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <Text style={ss.companionWelcome}>{t.companionWelcome(title)}</Text>
          )}
          {messages.map((m, i) => (
            <View key={`${m.role}-${i}`} style={[ss.msgBubble, m.role === "user" ? ss.msgUser : ss.msgAi]}>
              <Text style={ss.msgText}>{m.text}</Text>
            </View>
          ))}
          {busy && (
            <View style={[ss.msgBubble, ss.msgAi, ss.msgBusy]}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={ss.msgText}>{t.companionThinking}</Text>
            </View>
          )}
        </ScrollView>

        <Pressable onPress={onRecap} disabled={busy} style={[ss.companionChip, busy && { opacity: 0.5 }]}>
          <Ionicons name="sparkles" size={14} color={C.accent} />
          <Text style={ss.companionChipText}>{t.companionRecap}</Text>
        </Pressable>

        <View style={ss.companionInputRow}>
          <TextInput
            value={input}
            onChangeText={onChangeInput}
            placeholder={t.companionPlaceholder}
            placeholderTextColor={C.textMuted}
            style={ss.companionInput}
            editable={!busy}
            returnKeyType="send"
            onSubmitEditing={onSend}
            maxLength={500}
          />
          <Pressable
            onPress={onSend}
            disabled={busy || !input.trim()}
            style={[ss.companionSendBtn, (busy || !input.trim()) && { opacity: 0.5 }]}
          >
            <Ionicons name="send" size={16} color={C.textOnAccent} />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.player },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  player: { flex: 1, backgroundColor: C.player },
  playerWrap: { flex: 1 },

  overlay: { ...ABSOLUTE_FILL, justifyContent: "flex-start", zIndex: 3 },

  // Status / error states
  statusText: { color: "rgba(255,255,255,0.85)", fontSize: 15, fontWeight: "700", textAlign: "center", paddingHorizontal: 32, fontFamily: "Cairo_700Bold" },
  statusSub: { color: C.textMuted, fontSize: 13, textAlign: "center", fontFamily: "Cairo_500Medium" },
  errorTitle: { color: "rgba(255,255,255,0.7)", fontSize: 16, fontWeight: "700", marginTop: 8, textAlign: "center", paddingHorizontal: 32, fontFamily: "Cairo_700Bold" },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    minHeight: 48, backgroundColor: C.accent, borderRadius: R.md, paddingHorizontal: 24, paddingVertical: 12,
  },
  actionBtnText: { color: C.textOnAccent, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_700Bold" },

  // Gradient scrims
  gradTop: { position: "absolute", top: 0, left: 0, right: 0, height: 120 },
  gradBottom: { position: "absolute", bottom: 0, left: 0, right: 0, height: 150 },
  topBarGrad: { position: "absolute", top: 0, left: 0, right: 0, height: 110 },

  // Controls overlay
  controlsOverlay: { ...ABSOLUTE_FILL, justifyContent: "space-between", zIndex: 3 },
  bufferOverlay: { ...ABSOLUTE_FILL, alignItems: "center", justifyContent: "center", zIndex: 2 },
  partyWaitPill: {
    position: "absolute", bottom: 96, alignSelf: "center", zIndex: 3,
    flexDirection: "row-reverse", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 100,
    backgroundColor: "rgba(0,0,0,0.72)", borderWidth: 1, borderColor: C.border,
  },
  partyWaitText: { color: C.text, fontSize: 13, fontFamily: "Cairo_600SemiBold" },

  // Smart skip pill + HUD toast (AniSkip)
  skipPill: {
    position: "absolute", bottom: 118, right: 24, zIndex: 6,
    flexDirection: "row-reverse", alignItems: "center", gap: 8,
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 100,
    backgroundColor: C.accent,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 8,
  },
  skipPillText: { color: C.textOnAccent, fontSize: 13, fontFamily: "Cairo_700Bold" },
  toast: {
    position: "absolute", bottom: 180, alignSelf: "center", zIndex: 8,
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 100,
    backgroundColor: "rgba(0,0,0,0.78)", borderWidth: 1, borderColor: C.border,
  },
  toastText: { color: C.text, fontSize: 13, fontFamily: "Cairo_600SemiBold" },

  // Next-episode countdown card (appears at ≥97%)
  nextOverlay: {
    ...ABSOLUTE_FILL, alignItems: "center", justifyContent: "flex-end",
    paddingBottom: 132, zIndex: 8,
  },
  nextCard: {
    width: "92%", maxWidth: 420,
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(0,0,0,0.85)", borderWidth: 1, borderColor: C.border,
    borderRadius: R.lg, paddingHorizontal: 16, paddingVertical: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 10,
  },
  nextTimer: {
    width: 42, height: 42, borderRadius: 21,
    borderWidth: 2, borderColor: C.accent,
    alignItems: "center", justifyContent: "center",
  },
  nextTimerText: {
    color: C.white, fontSize: 18, fontWeight: "800",
    fontFamily: "Outfit_800ExtraBold", fontVariant: ["tabular-nums"],
  },
  nextTextCol: { flex: 1, minWidth: 0, gap: 2 },
  nextLabel: { color: C.white, fontSize: 14, fontFamily: "Cairo_700Bold" },
  nextHint: { color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium" },

  // Screen-lock overlay
  lockLayer: { ...ABSOLUTE_FILL, alignItems: "center", justifyContent: "center" },
  lockBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 26,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
  },
  lockBtnText: { color: C.white, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_700Bold" },

  // Top bar
  ctrlTopBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 18, paddingBottom: 12,
  },
  iconBtn: {
    width: 44, height: 44, borderRadius: R.md,
    backgroundColor: C.overlayBlack50,
    alignItems: "center", justifyContent: "center",
  },
  iconBtnAccent: {
    backgroundColor: "rgba(139,147,255,0.25)",
    borderColor: "rgba(139,147,255,0.5)",
  },

  // ── Watch Party ──
  partyCount: {
    position: "absolute", top: -2, right: -2, minWidth: 15, height: 15, borderRadius: 8,
    paddingHorizontal: 3, backgroundColor: C.accent, alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: C.player,
  },
  partyCountText: { color: C.black, fontSize: 9, fontFamily: "Outfit_800ExtraBold" },
  partyPanel: {
    position: "absolute", right: 12, zIndex: 9, width: 256, padding: 14, borderRadius: 14,
    backgroundColor: "rgba(10,10,11,0.94)", borderWidth: 1, borderColor: "rgba(139,147,255,0.30)",
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 22, elevation: 12,
  },
  partyHeadRow: { flexDirection: "row-reverse", alignItems: "center" },
  partyLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent, marginLeft: 7 },
  partyHeadText: { color: C.text, fontSize: 13, fontFamily: "Cairo_700Bold", flex: 1, textAlign: "right" },
  partyReadyPill: {
    marginRight: 6, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 100,
    backgroundColor: C.surfaceLight, borderWidth: 1, borderColor: C.border,
  },
  partyReadyPillText: { color: C.textSecondary, fontSize: 10, fontFamily: "Outfit_700Bold" },
  partyStatus: { color: C.textSecondary, fontSize: 11, marginTop: 4, textAlign: "right", fontFamily: "Cairo_500Medium" },

  // Live roster — one row per member, status on the leading (left in RTL) edge.
  // Margins, not `gap`, because RN 0.81 mis-lays `gap` under row-reverse.
  partyRoster: { marginTop: 12 },
  partyMember: { flexDirection: "row-reverse", alignItems: "center", paddingVertical: 5 },
  partyMAvatar: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: C.surfaceLight, marginLeft: 9,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border,
  },
  partyAvatarHost: { borderColor: C.accent, backgroundColor: C.accentSoft },
  partyAvatarText: { color: C.text, fontSize: 11, fontFamily: "Outfit_700Bold" },
  partyMName: { flex: 1, color: C.text, fontSize: 12, fontFamily: "Cairo_600SemiBold", textAlign: "right" },
  partyChip: { flexDirection: "row-reverse", alignItems: "center", marginRight: 6 },
  partyChipReady: { color: C.success, fontSize: 10, fontFamily: "Cairo_700Bold", marginRight: 4 },
  partyChipWait: { color: C.gold, fontSize: 10, fontFamily: "Cairo_600SemiBold", marginRight: 4 },

  // Host start gate. Ember-filled when armed; muted + non-interactive while any
  // viewer is still resolving a source.
  partyStartBtn: {
    flexDirection: "row-reverse", alignItems: "center", justifyContent: "center",
    marginTop: 12, paddingVertical: 11, borderRadius: 100, backgroundColor: C.accent,
  },
  partyStartBtnDisabled: { backgroundColor: C.surfaceLight, borderWidth: 1, borderColor: C.border },
  partyStartTxt: { color: C.black, fontSize: 13, fontFamily: "Cairo_700Bold", marginRight: 6 },
  partyStartTxtDisabled: { color: C.textMuted },

  partyLeave: {
    flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: 10, paddingVertical: 9, borderRadius: 10,
    backgroundColor: "rgba(255,87,71,0.10)", borderWidth: 1, borderColor: "rgba(255,87,71,0.25)",
  },
  partyLeaveText: { color: C.error, fontSize: 12, fontFamily: "Cairo_700Bold" },
  speedBtn: {
    height: 44, minWidth: 48, borderRadius: R.md, paddingHorizontal: 10,
    backgroundColor: C.overlayBlack50,
    alignItems: "center", justifyContent: "center",
  },
  speedBtnText: { color: C.white, fontSize: 12, fontWeight: "800", fontFamily: "Outfit_800ExtraBold", letterSpacing: 0.3 },
  titleArea: { flex: 1, gap: 3 },
  subtitleWrap: {
    position: "absolute", left: 18, right: 18, bottom: 36,
    alignItems: "center", justifyContent: "flex-end",
  },
  subtitleBox: { alignItems: "stretch" },
  subtitleOutline: { position: "absolute", left: 0, right: 0, top: 0, color: "#000" },
  subtitleText: {
    color: "#fff", fontSize: 16, lineHeight: 24, fontWeight: "700",
    fontFamily: "Cairo_600SemiBold", textAlign: "center",
  },
  subtitleTextRtl: { writingDirection: "rtl" },
  titleText: {
    color: C.white, fontSize: 15, fontWeight: "700", fontFamily: "Cairo_700Bold",
    textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 6,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  directPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(0,230,118,0.15)", borderWidth: 1, borderColor: "rgba(0,230,118,0.35)",
    borderRadius: 100, paddingHorizontal: 8, paddingVertical: 2,
  },
  directPillText: { color: C.success, fontSize: 8, fontWeight: "800", letterSpacing: 1, fontFamily: "Outfit_800ExtraBold" },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.success },
  serverLabelText: { color: C.textSecondary, fontSize: 11, fontFamily: "Cairo_500Medium", flexShrink: 1 },

  // Center cluster
  centerCluster: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 44,
  },
  playBtn: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.accent,
    alignItems: "center", justifyContent: "center",
  },
  skipBtn: {
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: C.overlayBlack50,
    alignItems: "center", justifyContent: "center",
  },
  skipLabel: { color: "rgba(255,255,255,0.7)", fontSize: 9, fontWeight: "800", marginTop: -3, fontFamily: "Outfit_800ExtraBold" },

  // Bottom area
  ctrlBottom: { paddingHorizontal: 20, gap: 10 },
  seekRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  timeText: {
    color: C.white, fontSize: 12, fontWeight: "700", minWidth: 42, textAlign: "center",
    fontFamily: "Outfit_700Bold", fontVariant: ["tabular-nums"],
  },
  timeTextDur: {
    color: C.textSecondary, fontSize: 12, fontWeight: "600", minWidth: 42, textAlign: "center",
    fontFamily: "Outfit_600SemiBold", fontVariant: ["tabular-nums"],
  },
  seekBarWrap: { flex: 1, height: 32, justifyContent: "center" },
  seekTrack: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden" },
  seekTrackActive: { height: 6, borderRadius: 3 },
  seekFill: { height: "100%", borderRadius: 3, backgroundColor: C.accent },
  seekThumb: {
    position: "absolute", top: 9, marginLeft: -7,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: C.accent, borderWidth: 2, borderColor: C.white,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 4,
  },
  seekThumbActive: { top: 6, marginLeft: -10, width: 20, height: 20, borderRadius: 10 },
  seekTouchArea: { position: "absolute", left: 0, right: 0, top: -12, bottom: -12 },
  seekBubble: {
    position: "absolute", bottom: 22, marginLeft: -28, width: 56,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.85)", borderRadius: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
  },
  seekBubbleText: { color: C.white, fontSize: 12, fontWeight: "800", fontFamily: "Outfit_800ExtraBold", fontVariant: ["tabular-nums"] },
  ctrlRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chipBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.overlayBlack50,
    minHeight: 48, borderRadius: R.md, paddingHorizontal: 16, paddingVertical: 10,
  },
  chipBtnText: { color: C.white, fontSize: 12, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },
  chipBtnActive: {
    borderWidth: 1, borderColor: C.borderAccent,
    backgroundColor: "rgba(139,147,255,0.16)",
  },
  chipBtnAccent: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.accent,
    minHeight: 48, borderRadius: R.md, paddingHorizontal: 18, paddingVertical: 10,
  },
  chipBtnAccentText: { color: C.textOnAccent, fontSize: 12, fontWeight: "700", fontFamily: "Cairo_700Bold" },

  // Server selection layout (pre-playback)
  selHeader: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  selTitle: { color: C.white, fontSize: 17, fontWeight: "800", fontFamily: "Cairo_700Bold" },
  selSub: { color: C.textMuted, fontSize: 13, marginTop: 4, fontFamily: "Cairo_500Medium" },
  selContent: {
    // direction:"ltr" + explicit column so the Arabic-locale RTL flip can't
    // turn the list into a row; gap dropped (RN 0.81 gap+row-reverse Yoga bug)
    // — per-item marginBottom spaces the rows instead.
    direction: "ltr", flexDirection: "column",
    alignSelf: "center", width: "100%", maxWidth: 720,
    paddingHorizontal: 24, paddingVertical: 16,
  },
  selSectionLabel: {
    color: C.textMuted, fontSize: 12, fontWeight: "700",
    letterSpacing: 0.6, marginTop: 8, marginBottom: 2, fontFamily: "Cairo_700Bold",
  },
  selFinding: {
    direction: "rtl", flexDirection: "row", alignItems: "center", justifyContent: "center",
    minHeight: 48, marginTop: 4,
  },
  selFindingText: { color: C.textMuted, fontSize: 13, marginRight: 10, fontFamily: "Cairo_500Medium" },
  selItem: {
    // direction:"ltr" keeps avatar→info→play laid out left-to-right and, by
    // pinning the row to ltr (not RTL row-reverse), keeps `gap` safe from the
    // RN 0.81 gap+row-reverse Yoga bug. marginBottom replaces the list gap.
    direction: "ltr", flexDirection: "row", alignItems: "center", gap: 12,
    marginBottom: 8,
    minHeight: 72, paddingVertical: 16, paddingHorizontal: 18, borderRadius: R.md,
    backgroundColor: C.surfaceContainer,
    borderWidth: 1, borderColor: C.borderSoft,
  },
  selItemRec: {
    backgroundColor: "rgba(139,147,255,0.1)",
    borderColor: "rgba(139,147,255,0.4)",
  },
  qualityBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  qualityBadgeHi: {
    backgroundColor: "rgba(139,147,255,0.16)", borderColor: "rgba(139,147,255,0.4)",
  },
  qualityBadgeText: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "800", fontFamily: "Outfit_800ExtraBold", letterSpacing: 0.3 },

  // Server picker
  pickerOverlay: { ...ABSOLUTE_FILL, flexDirection: "row", zIndex: 10 },
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)" },
  pickerSheet: {
    width: "58%", maxWidth: 480, backgroundColor: C.playerSheet,
    paddingHorizontal: 24, paddingBottom: 20,
    borderTopLeftRadius: R.xl, borderBottomLeftRadius: R.xl,
    borderLeftWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  pickerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  pickerHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  pickerHeaderIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "rgba(139,147,255,0.14)", borderWidth: 1, borderColor: "rgba(139,147,255,0.3)",
    alignItems: "center", justifyContent: "center",
  },
  pickerTitle: { color: C.white, fontSize: 17, fontWeight: "800", fontFamily: "Cairo_700Bold" },
  pickerSub: { color: C.textMuted, fontSize: 12, marginTop: 4, fontFamily: "Cairo_500Medium" },
  pickerScroll: { flex: 1 },
  pickerContent: { gap: 7, paddingBottom: 20 },
  emptyText: {
    color: C.textMuted, fontSize: 13, textAlign: "center",
    paddingVertical: 24, fontFamily: "Cairo_500Medium",
  },

  // رفيق الأنمي — companion drawer
  companionBody: { flex: 1 },
  companionMessages: { paddingVertical: 6, gap: 8 },
  companionWelcome: {
    color: C.textSecondary, fontSize: 13, lineHeight: 21,
    textAlign: "right", writingDirection: "rtl", fontFamily: "Cairo_500Medium",
  },
  msgBubble: { maxWidth: "92%", borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 9 },
  msgUser: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(139,147,255,0.18)",
    borderWidth: 1, borderColor: C.borderAccent,
  },
  msgAi: {
    alignSelf: "flex-start",
    backgroundColor: C.surfaceContainer,
    borderWidth: 1, borderColor: C.borderSoft,
  },
  msgBusy: { flexDirection: "row", alignItems: "center", gap: 8 },
  msgText: {
    color: C.text, fontSize: 13, lineHeight: 20,
    textAlign: "right", writingDirection: "rtl", fontFamily: "Cairo_500Medium",
  },
  companionChip: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    alignSelf: "flex-end", marginTop: 8, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 100, backgroundColor: "rgba(139,147,255,0.12)",
    borderWidth: 1, borderColor: C.borderAccent,
  },
  companionChipText: { color: C.accent, fontSize: 12, fontFamily: "Cairo_600SemiBold" },
  companionInputRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  companionInput: {
    flex: 1, minHeight: 44, borderRadius: R.md, paddingHorizontal: 14,
    backgroundColor: C.surfaceContainer, borderWidth: 1, borderColor: C.borderSoft,
    color: C.text, fontSize: 13, textAlign: "right", fontFamily: "Cairo_500Medium",
  },
  companionSendBtn: {
    width: 44, height: 44, borderRadius: R.md, backgroundColor: C.accent,
    alignItems: "center", justifyContent: "center",
  },

  serverItem: {
    flexDirection: "row", alignItems: "center", gap: 11,
    minHeight: 68, paddingVertical: 14, paddingHorizontal: 14, borderRadius: R.md,
    backgroundColor: C.surfaceContainer,
    borderWidth: 1, borderColor: C.borderSoft,
  },
  serverItemActive: {
    backgroundColor: "rgba(139,147,255,0.12)",
    borderColor: "rgba(139,147,255,0.45)",
  },
  serverAvatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  serverAvatarText: { color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  serverStatusDot: {
    position: "absolute", bottom: -1, right: -1,
    width: 10, height: 10, borderRadius: 5,
    borderWidth: 2, borderColor: C.playerSheet,
  },
  serverInfo: { flex: 1 },
  serverName: { color: C.white, fontSize: 13, fontWeight: "700", fontFamily: "Outfit_600SemiBold" },
  serverNameActive: { color: C.accent },
  serverMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  serverMetaLabel: { fontSize: 10, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },
  serverMeta: { color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium", flexShrink: 1 },
  activeBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: C.accent, borderRadius: 100, paddingHorizontal: 8, paddingVertical: 3,
  },
  activeBadgeText: { color: C.textOnAccent, fontSize: 8, fontWeight: "800", letterSpacing: 0.8, fontFamily: "Outfit_800ExtraBold" },

  // Brightness indicator
  brightnessIndicator: {
    position: "absolute", left: 28, top: 0, bottom: 0,
    alignItems: "center", justifyContent: "center", gap: 10, zIndex: 7,
  },
  brightnessBarTrack: {
    width: 6, height: 120, borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.22)",
    justifyContent: "flex-end", overflow: "hidden",
  },
  brightnessBarFill: { width: 6, borderRadius: 3, backgroundColor: C.white },
  brightnessPct: { color: C.white, fontSize: 11, fontWeight: "800", fontFamily: "Outfit_800ExtraBold", fontVariant: ["tabular-nums"] },
});
