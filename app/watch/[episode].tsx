import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  StatusBar,
  PanResponder,
  Dimensions,
  Animated,
  Easing,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ScreenOrientation from "expo-screen-orientation";
import { Ionicons } from "@expo/vector-icons";
import { fetchCompleteVideoServers, resolveVideo, prefetchAnime3rbServers } from "../../lib/api";
import type { VideoServer } from "../../lib/api";
import { saveProgress, getProgress } from "../../lib/history";
import { recordEpisodeWatched } from "../../lib/completion";
import { getDownloadByEpisode, subscribeDownloads, type DownloadStatus, type DownloadMeta } from "../../lib/downloads";
import { DownloadPicker } from "../../components/DownloadPicker";
import { getAutoplayNext } from "../../lib/settings";
import { maybeShowInterstitial } from "../../lib/ads";
import { useAuth } from "../../lib/auth";
import { useWatchPartySync, createRoom } from "../../lib/watchParty";
import { C } from "../../lib/theme";
import { t } from "../../lib/i18n";
import { useReducedMotion } from "../../lib/motion";
import {
  createGenerationGuard,
  providerFailureMode,
  providerRank,
  qualityScore,
  sortVideoServers,
  videoContentType,
  videoPlaybackHeaders,
} from "../../lib/videoProviders";
import { _cancelBackground } from "../../lib/scraper/bus";

type ServerStatus = "idle" | "resolving" | "playing" | "webview" | "failed";

interface ServerState {
  server: VideoServer & { source?: string };
  status: ServerStatus;
  videoUrl: string | null;
}

// Where a server should land when direct resolution is exhausted.
const failStatus = (provider?: string): ServerStatus =>
  providerFailureMode(provider) as ServerStatus;

const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];

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
  setInterval(function(){
    var pos=0,dur=0;
    try {
      // Standard video element
      var v=document.querySelector('video');
      if(v&&v.duration>0){pos=v.currentTime*1000;dur=v.duration*1000;}
      // JW Player
      if(!pos&&typeof jwplayer==='function'){
        try{var p=jwplayer();if(p&&p.getPosition&&p.getDuration){pos=p.getPosition()*1000;dur=p.getDuration()*1000;}}catch(e){}
      }
      // VideoJS
      if(!pos&&typeof videojs==='function'){
        try{var vj=videojs(document.querySelector('.video-js'));if(vj&&vj.currentTime&&vj.duration){pos=vj.currentTime()*1000;dur=vj.duration()*1000;}}catch(e){}
    }catch(e){}
    if(pos>0&&dur>0){
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'progress',pos:Math.round(pos),dur:Math.round(dur)}));
    }
  },3000);
})();
true;
`;

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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [animeTitle, setAnimeTitle] = useState("");
  const [animeHref, setAnimeHref] = useState("");
  const [nextEpisodeHref, setNextEpisodeHref] = useState<string | null>(null);
  const [prevEpisodeHref, setPrevEpisodeHref] = useState<string | null>(null);
  const [servers, setServers] = useState<ServerState[]>([]);
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
  useEffect(() => { getAutoplayNext().then((v) => { autoplayRef.current = v; }); }, []);
  // Once per episode: marks the completion badge when the LAST episode is
  // finished, so it doesn't wait for a detail-page revisit.
  const completionMarkedRef = useRef(false);
  useEffect(() => {
    autoAdvancedRef.current = false;
    completionMarkedRef.current = false;
    setLocked(false);
    setSelfReady(false); // re-buffer for the new episode → re-arm the party gate
    // Re-arm the server-selection gate for the new episode, unless this is an
    // auto-play hop (next/prev/autoplay) or an offline file — those play directly.
    setPicked(!!autoParam || !!localParam);
  }, [episode]);

  // Fire auto-advance when playback nears the end (≥97%) and a next episode
  // exists. Shared by the native + WebView progress timers.
  const maybeAutoAdvance = useCallback((pos: number, dur: number) => {
    if (partyClientRef.current) return; // host drives episode changes
    if (!autoplayRef.current || autoAdvancedRef.current) return;
    if (dur > 0 && pos / dur >= 0.97) {
      autoAdvancedRef.current = true;
      goNextRef.current?.();
    }
  }, []);

  // Mark the anime "caught up"/"finished" the moment this episode crosses the
  // 80% watched threshold — same bar history uses for "completed". If it's the
  // latest available episode, the poster badge flips immediately instead of
  // waiting for the user to reopen the anime's detail page. Recording is gated
  // on a real completion record existing (the detail page establishes the
  // highest-available episode number); it then re-checks AniList for finale
  // status internally. Runs at most once per episode.
  const maybeMarkCompleted = useCallback((pos: number, dur: number) => {
    if (completionMarkedRef.current) return;
    if (dur <= 0 || pos / dur < 0.8) return;
    completionMarkedRef.current = true;
    let epNum: number | null = paramEpNum;
    if (epNum == null && episode) {
      const u = decodeURIComponent(episode);
      const m = u.match(/الحلقة[\s\-_]*(\d+)/) || u.match(/\/episode\/[^/]+\/(\d+)/);
      if (m) epNum = parseInt(m[1], 10);
    }
    if (epNum == null) return;
    const aTitle = (animeTitleParam ? decodeURIComponent(animeTitleParam) : "") || animeTitle;
    const aHref = animeHref || (animeParam ? decodeURIComponent(animeParam) : "");
    recordEpisodeWatched({ animeHref: aHref, animeTitle: aTitle, epNum }).catch(() => {});
  }, [paramEpNum, episode, animeTitle, animeHref, animeTitleParam, animeParam]);

  // Keep serversRef in sync so timers/async handlers can read the live count.
  useEffect(() => { serversRef.current = servers; }, [servers]);

  const active = servers[activeIdx];
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
      // so 8s is the documented analog of ExoPlayer's
      // bufferForPlaybackAfterRebufferMs. Costs ~3s of extra wait at the
      // throttled rate on first start; pays for itself within one stall by not
      // dropping straight from a stall back into another (the stutter loop).
      minBufferForPlayback: 8,
      maxBufferBytes: 0,
      prioritizeTimeOverSizeThreshold: true,
      // iOS: let AVPlayer delay playback to build a stall-proof buffer instead
      // of starting on a thread-bare one and rebuffering immediately.
      waitsToMinimizeStalling: true,
    };
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
      };
    }, [player]),
  );

  // Force play on native player when source changes
  useEffect(() => {
    if (!videoUrl || !player) return;
    const tryPlay = () => {
      // Never auto-resume a blurred (backgrounded) screen, or a host-gated room.
      if (!focusedRef.current || holdPlaybackRef.current) return;
      try {
        // Resume after a self-heal re-resolve (fresh token, same episode).
        if (pendingSeekRef.current > 0) {
          player.currentTime = pendingSeekRef.current / 1000;
          pendingSeekRef.current = 0;
        }
        player.play();
      } catch {}
    };
    tryPlay();
    const t1 = setTimeout(tryPlay, 500);
    const t2 = setTimeout(tryPlay, 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [videoUrl, player]);

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
      } catch {
        fail();
      }
    };

    // Poll for "started playing" every 250ms; once we see motion, lock in.
    const watchdog = setInterval(() => {
      if (cancelled || healing || !focusedRef.current) return; // don't heal a blurred screen
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
    }, 250);

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
      clearInterval(watchdog);
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

  // Load progress + control auto-hide (orientation handled above).
  useEffect(() => {
    scheduleHide();
    if (episode) {
      getProgress(decodeURIComponent(episode)).then((entry) => {
        if (entry && entry.positionMs > 0) setResumeMs(entry.positionMs);
      });
    }
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, []);

  // Show a (frequency-capped) interstitial when an episode is opened. Opening
  // an episode is a natural break; the 3-min cap in lib/ads.ts keeps fast
  // next/prev hopping from spamming ads. No-op until ad IDs are configured.
  useEffect(() => {
    if (!episode) return;
    maybeShowInterstitial("before_episode");
  }, [episode]);

  // Save progress (native player)
  useEffect(() => {
    if (!isPlaying || !player || !episode) return;
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => {
      try {
        const pos = player.currentTime * 1000;
        const dur = player.duration * 1000;
        if (pos > 0 && dur > 0) {
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
      } catch {}
    }, 5000);
    return () => { if (progressTimer.current) clearInterval(progressTimer.current); };
  }, [isPlaying, player, episode, title, animeTitle, animeHref, url4up, imgParam, maybeMarkCompleted]);

  // Save progress (WebView player) — receives position from injected JS
  const lastWebViewPos = useRef<{ pos: number; dur: number }>({ pos: 0, dur: 0 });
  useEffect(() => {
    if (!isWebView || !episode) return;
    if (progressTimer.current) clearInterval(progressTimer.current);
    progressTimer.current = setInterval(() => {
      const { pos, dur } = lastWebViewPos.current;
      if (pos > 0 && dur > 0) {
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
    return () => { if (progressTimer.current) clearInterval(progressTimer.current); };
  }, [isWebView, episode, title, animeTitle, animeHref, url4up, imgParam, maybeMarkCompleted]);

  // WebView progress message handler
  const onWebViewProgress = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "progress" && msg.pos > 0 && msg.dur > 0) {
        lastWebViewPos.current = { pos: msg.pos, dur: msg.dur };
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
      setServers([{
        server: { id: "local", name: t.downloaded, iframeUrl: "", provider: "local", source: "local" },
        status: "playing",
        videoUrl: localUri,
      }]);
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
    // Next is the strong signal (autoplay/binge); previous is cheap insurance.
    prefetchAnime3rbServers(lookupTitle, epNum + 1);
    if (epNum > 1) prefetchAnime3rbServers(lookupTitle, epNum - 1);
  }, [a3rbServerCount, episode, animeTitle, animeTitleParam, animeParam, paramEpNum]);

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

    // mega.nz / vk never resolve to a direct URL (mega decrypts AES chunks
    // in-page via MediaSource) — selecting them used to stall ~30s in a
    // doomed extraction before falling back. Go straight to the embed.
    if (srv.provider === "mega" || srv.provider === "vk") {
      setServers((p) => p.map((s, i) => i === idx ? { ...s, status: "webview" } : s));
      return;
    }

    setServers((p) => p.map((s, i) => i === idx ? { ...s, status: "resolving" } : s));
    const resolution = ++activeResolutionRef.current;
    void resolveVideo(url, srv.provider, { priority: true, fresh: true }).then((result) => {
      if (activeResolutionRef.current !== resolution) return;
      setServers((p) => p.map((s, i) =>
        i !== idx || s.server.iframeUrl !== srv.iframeUrl
          ? s
          : result.success && result.data?.videoUrl
            ? { ...s, status: "playing", videoUrl: result.data.videoUrl }
            : { ...s, status: failStatus(srv.provider), videoUrl: null }));
    }).catch(() => {
      if (activeResolutionRef.current !== resolution) return;
      setServers((p) => p.map((s, i) =>
        i === idx && s.server.iframeUrl === srv.iframeUrl
          ? { ...s, status: failStatus(srv.provider), videoUrl: null }
          : s));
    });
  }, [activeIdx, servers.length > 0 ? servers[activeIdx]?.status : null, picked, episode]);

  // Auto-advance to next server on failure (only after a server was chosen —
  // during selection the active index must stay put).
  useEffect(() => {
    if (!picked) return;
    if (servers.length === 0) return;
    const state = servers[activeIdx];
    if (state?.status !== "failed") return;
    const next = servers.findIndex((s, i) => i !== activeIdx && (s.status === "idle" || s.status === "playing" || s.status === "webview"));
    if (next !== -1) setActiveIdx(next);
  }, [servers, activeIdx, picked]);

  const selectServer = useCallback((idx: number) => {
    // A failed server gets a fresh chance when the user explicitly taps it —
    // reset to idle so the resolve effect re-runs the extraction.
    retryCountRef.current[idx] = 0;
    setServers((p) => p.map((s, i) =>
      i === idx && s.status === "failed" ? { ...s, status: "idle", videoUrl: null } : s));
    setActiveIdx(idx);
    setPickerOpen(false);
  }, []);

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
    anime: animeParam ?? "",
    img: imgParam ?? "",
    animeTitle: animeTitleParam ?? "",
    epNum: epNumParam ?? "",
  }), [url4up, animeParam, imgParam, animeTitleParam, epNumParam]);
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
        // Ready = a playable source is RESOLVED (direct URL or embed). Buffer-
        // based readiness (duration/readyToPlay) was unreliable: a gated or
        // host-paused player never reports a duration, so members stayed
        // "buffering" forever and the gate never released. Source-resolved is
        // reliable for every role, and a slow connection (slow to resolve) still
        // makes the host wait.
        if (active?.status === "playing" || active?.status === "webview" || player.duration > 0) {
          setSelfReady(true);
        }
      } catch {}
    }, 500);
    return () => { clearTimeout(cap); clearInterval(iv); };
  }, [party.code, selfReady, isWebView, player, episode, active?.status]);
  const startParty = useCallback(() => {
    if (!user) return;
    createRoom(user).catch(() => {});
    setPartyPanelOpen(true);
  }, [user]);

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

  const togglePlayPause = useCallback(() => {
    if (partyClientRef.current) return; // host controls playback in a party
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

  // ── SLOW-CONNECTION QUALITY STEP-DOWN ──
  // anime3rb exposes each quality as its own server (1080p default), but each
  // stream is a fixed-bitrate progressive MP4 — on a connection slower than
  // that bitrate it rebuffers forever and there's no ABR to save it. Watch
  // cumulative MID-WATCH buffering on an anime3rb server; once ~20s of it
  // piles up, hop to the next lower quality at the same position instead of
  // letting the user grind through the stutter loop.
  useEffect(() => {
    if (!isPlaying || !player || !picked) return;
    const idx = activeIdx;
    if (serversRef.current[idx]?.server.source !== "anime3rb") return;
    let stalledMs = 0;
    const iv = setInterval(() => {
      try {
        if (!focusedRef.current || isPausedRef.current) return;
        // Mid-watch only — currentTime > 0 means the initial load is behind us.
        if (!(player.currentTime > 0) || (player.status as string) !== "loading") return;
        stalledMs += 1000;
        if (stalledMs < 20000) return;
        clearInterval(iv);
        const list = serversRef.current;
        const curQ = qualityScore(list[idx]?.server.name || "");
        // Highest-quality sibling still BELOW the current one (1080→720→480).
        let nextIdx = -1, nextQ = -1;
        list.forEach((s, i) => {
          const q = qualityScore(s.server.name);
          if (i !== idx && s.server.source === "anime3rb" && s.status !== "failed" && q < curQ && q > nextQ) {
            nextIdx = i; nextQ = q;
          }
        });
        if (nextIdx === -1) return;
        console.log(`[quality] ${list[idx]?.server.name} rebuffered ${Math.round(stalledMs / 1000)}s — stepping down to ${list[nextIdx].server.name}`);
        pendingSeekRef.current = Math.round(player.currentTime * 1000);
        selectServer(nextIdx);
      } catch {}
    }, 1000);
    return () => clearInterval(iv);
  }, [isPlaying, player, picked, activeIdx, selectServer]);

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
    if (pickerOpen) return;
    if (controlsVisible) {
      setControlsVisible(false);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    } else {
      showControls();
    }
  }, [pickerOpen, controlsVisible, showControls]);

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
            player={player}
            style={ss.player}
            nativeControls={false}
            contentFit={videoFit}
            allowsPictureInPicture
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
          allowsInlineMediaPlayback
          setSupportMultipleWindows={false}
          originWhitelist={["https://*", "http://*"]}
          injectedJavaScript={ADBLOCK_JS + PROGRESS_JS}
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
            <Ionicons name="refresh" size={16} color={C.white} />
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
      {!isPlaying && !pickerOpen && (
        <Pressable
          style={[StyleSheet.absoluteFill, { zIndex: 1 }]}
          onPress={tapToToggle}
          pointerEvents={isWebView && controlsVisible ? 'box-none' : 'auto'}
        />
      )}

      {/* Full-screen tap zone during native playback — when our chrome is
          hidden, tapping ANYWHERE shows it (like YouTube / Netflix). Once
          the chrome is visible we remove this overlay so taps reach
          expo-video's native controls. */}
      {isPlaying && !pickerOpen && !controlsVisible && !locked && (
        <View
          style={[StyleSheet.absoluteFill, { zIndex: 2 }]}
          {...brightnessPan.panHandlers}
        />
      )}

      {/* LOCKED: every gesture is dead except this floating unlock button. A
          tap anywhere reveals it (auto-hides with the chrome timer); tapping it
          lifts the lock and restores the normal controls. */}
      {isPlaying && locked && (
        <Pressable style={[StyleSheet.absoluteFill, { zIndex: 7 }]} onPress={showControls}>
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

      {/* Custom Controls Overlay */}
      {isPlaying && !pickerOpen && controlsVisible && !locked && (
        <View style={ss.controlsOverlay} pointerEvents="box-none">
          {/* Tap on empty space hides the chrome; vertical swipe adjusts brightness */}
          <View style={StyleSheet.absoluteFill} {...brightnessPan.panHandlers} />
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
            <Pressable onPress={goToAnimePage} style={ss.titleArea} hitSlop={6}>
              <Text style={ss.titleText} numberOfLines={1}>{title}</Text>
              {active && (
                <View style={ss.metaRow}>
                  <View style={ss.directPill}>
                    <View style={ss.liveDot} />
                    <Text style={ss.directPillText}>DIRECT</Text>
                  </View>
                  <Text style={ss.serverLabelText} numberOfLines={1}>
                    {getDisplayName(active.server)}
                  </Text>
                </View>
              )}
            </Pressable>
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
                <ActivityIndicator size="large" color={C.white} />
              ) : (
                <Ionicons
                  name={isPlayerPaused ? "play" : "pause"}
                  size={38}
                  color={C.white}
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
              <Pressable onPress={skipForward85} style={ss.chipBtn}>
                <Ionicons name="play-forward-circle-outline" size={16} color={C.white} />
                <Text style={ss.chipBtnText}>{t.skipIntro}</Text>
              </Pressable>

              <View style={{ flexDirection: "row", gap: 8 }}>
                {prevEpisodeHref && (
                  <Pressable onPress={goPrevEpisode} style={ss.chipBtn}>
                    <Ionicons name="play-skip-back" size={14} color={C.white} />
                    <Text style={ss.chipBtnText}>{t.prevEpisode}</Text>
                  </Pressable>
                )}
                {nextEpisodeHref && (
                  <Pressable onPress={() => goNextEpisode()} style={ss.chipBtnAccent}>
                    <Text style={ss.chipBtnAccentText}>{t.nextEpisode}</Text>
                    <Ionicons name="play-skip-forward" size={14} color={C.white} />
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </View>
      )}

      {/* TOP BAR for non-native states (WebView, loading) */}
      {controlsVisible && !pickerOpen && !isPlaying && (
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
            <Pressable onPress={goToAnimePage} style={ss.titleArea} hitSlop={6}>
              <Text style={ss.titleText} numberOfLines={1}>{title}</Text>
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
            </Pressable>
            <Pressable onPress={goToAnimePage} style={ss.iconBtn} hitSlop={6}>
              <Ionicons name="information-circle-outline" size={20} color={C.white} />
            </Pressable>
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
          style={[StyleSheet.absoluteFill, { backgroundColor: C.player, opacity: (1 - brightness) * 0.92, zIndex: 6 }]}
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
        <Pressable style={StyleSheet.absoluteFill} onPress={animateClose} />
      </Animated.View>
      <Animated.View style={[ss.pickerSheet, { paddingTop: (insets.top || 10) + 10, transform: [{ translateX }] }]}>
        <View style={ss.pickerHeader}>
          <View style={ss.pickerHeaderLeft}>
            <View style={ss.pickerHeaderIcon}>
              <Ionicons name="server-outline" size={16} color={C.accent} />
            </View>
            <View>
              <Text style={ss.pickerTitle}>Servers</Text>
              <Text style={ss.pickerSub}>
                {servers.filter((s) => s.status === "playing" || s.status === "webview").length} of {servers.length} ready
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
              : "rgba(255,255,255,0.35)";
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
                    <Ionicons name="play" size={9} color={C.white} />
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

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.player },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  player: { flex: 1, backgroundColor: C.player },
  playerWrap: { flex: 1 },

  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-start", zIndex: 3 },

  // Status / error states
  statusText: { color: "rgba(255,255,255,0.85)", fontSize: 15, fontWeight: "700", textAlign: "center", paddingHorizontal: 32, fontFamily: "Cairo_700Bold" },
  statusSub: { color: "rgba(255,255,255,0.45)", fontSize: 12, textAlign: "center", fontFamily: "Cairo_500Medium" },
  errorTitle: { color: "rgba(255,255,255,0.7)", fontSize: 16, fontWeight: "700", marginTop: 8, textAlign: "center", paddingHorizontal: 32, fontFamily: "Cairo_700Bold" },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.accent, borderRadius: 24, paddingHorizontal: 22, paddingVertical: 11,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.22, shadowRadius: 14, elevation: 6,
  },
  actionBtnText: { color: C.white, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_700Bold" },

  // Gradient scrims
  gradTop: { position: "absolute", top: 0, left: 0, right: 0, height: 120 },
  gradBottom: { position: "absolute", bottom: 0, left: 0, right: 0, height: 150 },
  topBarGrad: { position: "absolute", top: 0, left: 0, right: 0, height: 110 },

  // Controls overlay
  controlsOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: "space-between", zIndex: 3 },
  bufferOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", zIndex: 2 },
  partyWaitPill: {
    position: "absolute", bottom: 96, alignSelf: "center", zIndex: 3,
    flexDirection: "row-reverse", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 100,
    backgroundColor: "rgba(0,0,0,0.72)", borderWidth: 1, borderColor: C.border,
  },
  partyWaitText: { color: C.text, fontSize: 13, fontFamily: "Cairo_600SemiBold" },

  // Screen-lock overlay
  lockLayer: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  lockBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 26,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
  },
  lockBtnText: { color: C.white, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_700Bold" },

  // Top bar
  ctrlTopBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 18, paddingBottom: 12,
  },
  iconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
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
    height: 38, minWidth: 48, borderRadius: 19, paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  speedBtnText: { color: C.white, fontSize: 12, fontWeight: "800", fontFamily: "Outfit_800ExtraBold", letterSpacing: 0.3 },
  titleArea: { flex: 1, gap: 3 },
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
  serverLabelText: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontFamily: "Cairo_500Medium", flexShrink: 1 },

  // Center cluster
  centerCluster: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 44,
  },
  playBtn: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: "rgba(139,147,255,0.9)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.25)",
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 18, elevation: 10,
  },
  skipBtn: {
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.14)",
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
    color: "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: "600", minWidth: 42, textAlign: "center",
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
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 100, paddingHorizontal: 14, paddingVertical: 8,
  },
  chipBtnText: { color: C.white, fontSize: 12, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },
  chipBtnAccent: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.accent,
    borderRadius: 100, paddingHorizontal: 16, paddingVertical: 8,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 6,
  },
  chipBtnAccentText: { color: C.white, fontSize: 12, fontWeight: "800", fontFamily: "Cairo_700Bold" },

  // Server selection layout (pre-playback)
  selHeader: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  selTitle: { color: C.white, fontSize: 17, fontWeight: "800", fontFamily: "Cairo_700Bold" },
  selSub: { color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 1, fontFamily: "Cairo_500Medium" },
  selContent: {
    // direction:"ltr" + explicit column so the Arabic-locale RTL flip can't
    // turn the list into a row; gap dropped (RN 0.81 gap+row-reverse Yoga bug)
    // — per-item marginBottom spaces the rows instead.
    direction: "ltr", flexDirection: "column",
    alignSelf: "center", width: "100%", maxWidth: 720,
    paddingHorizontal: 24, paddingVertical: 16,
  },
  selSectionLabel: {
    color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: "800",
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
    paddingVertical: 12, paddingHorizontal: 13, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
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
  pickerOverlay: { ...StyleSheet.absoluteFillObject, flexDirection: "row", zIndex: 10 },
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)" },
  pickerSheet: {
    width: "58%", backgroundColor: C.playerSheet,
    paddingHorizontal: 16, paddingBottom: 16,
    borderTopLeftRadius: 24, borderBottomLeftRadius: 24,
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
  pickerSub: { color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 1, fontFamily: "Cairo_500Medium" },
  pickerScroll: { flex: 1 },
  pickerContent: { gap: 7, paddingBottom: 20 },

  serverItem: {
    flexDirection: "row", alignItems: "center", gap: 11,
    paddingVertical: 10, paddingHorizontal: 11, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.05)",
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
  serverMeta: { color: "rgba(255,255,255,0.35)", fontSize: 10, fontFamily: "Cairo_500Medium", flexShrink: 1 },
  activeBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: C.accent, borderRadius: 100, paddingHorizontal: 8, paddingVertical: 3,
  },
  activeBadgeText: { color: C.white, fontSize: 8, fontWeight: "800", letterSpacing: 0.8, fontFamily: "Outfit_800ExtraBold" },

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
