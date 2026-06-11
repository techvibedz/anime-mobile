import { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  StatusBar,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useLocalSearchParams, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ScreenOrientation from "expo-screen-orientation";
import { Ionicons } from "@expo/vector-icons";
import { fetchVideoServers, resolveVideo, getProxyUrl } from "../../lib/api";
import type { VideoServer } from "../../lib/api";
import { saveProgress, getProgress } from "../../lib/history";
import { C } from "../../lib/theme";
import { t } from "../../lib/i18n";

type ServerStatus = "idle" | "resolving" | "playing" | "webview" | "failed";

interface ServerState {
  server: VideoServer & { source?: string };
  status: ServerStatus;
  videoUrl: string | null;
}

// Lower = tried first. Providers proven to resolve to direct .m3u8/.mp4 URLs (so they
// play in the native expo-video player) are ranked above providers that fall back to WebView.
const PROVIDER_RANK: Record<string, number> = {
  dailymotion: 0,   // HLS via metadata API — reliable
  mp4upload: 1,     // direct MP4 via packed JS — reliable
  streamwish: 2,    // HLS via packed JS — reliable
  videa: 3,         // MP4 via request interception — reliable
  voe: 4,           // HLS via base64 sources extractor
  doodstream: 5,    // MP4 via pass_md5 token extractor
  okru: 6,          // HLS via data-options metadata
  share4max: 7,     // packed JS; falls back to WebView
  streamruby: 7,    // packed JS; falls back to WebView
  uqload: 8,        // packed JS; falls back to WebView
  larhu: 9,
  generic: 10,
  vk: 11,           // WebView only
  mega: 12,         // WebView only
  yonaplay: 99,     // blocked server-side
};

const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];

function qualityScore(name: string): number {
  const n = (name || "").toLowerCase();
  if (n.includes("fhd") || n.includes("1080")) return 3;
  if (n.includes("hd") || n.includes("720")) return 2;
  if (n.includes("sd") || n.includes("480") || n.includes("360")) return 0;
  return 1;
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
  const { episode, url4up, img: imgParam, nextEp: nextEpParam, prevEp: prevEpParam, anime: animeParam } = useLocalSearchParams<{
    episode: string; url4up?: string; img?: string; nextEp?: string; prevEp?: string; anime?: string;
  }>();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [animeTitle, setAnimeTitle] = useState("");
  const [animeHref, setAnimeHref] = useState("");
  const [nextEpisodeHref, setNextEpisodeHref] = useState<string | null>(null);
  const [prevEpisodeHref, setPrevEpisodeHref] = useState<string | null>(null);
  // anime4up sibling URLs for the next/prev episodes, so url4up keeps
  // flowing when the user switches episodes from the player controls.
  const [nextUp4Href, setNextUp4Href] = useState<string | null>(null);
  const [prevUp4Href, setPrevUp4Href] = useState<string | null>(null);
  // anime4up URL for the CURRENT episode, resolved when it wasn't passed as a
  // nav param (e.g. opened from home / history / hero). Used to append the
  // anime4up servers after the witanime ones are already showing.
  const [currentUp4Href, setCurrentUp4Href] = useState<string | null>(null);
  const [servers, setServers] = useState<ServerState[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [resumeMs, setResumeMs] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const active = servers[activeIdx];
  const videoUrl = active?.videoUrl ?? null;
  const isPlaying = active?.status === "playing" && !!videoUrl;
  const isWebView = active?.status === "webview";
  const iframeUrl = getIframeUrl(active?.server);

  // CDNs refuse playback without the right Referer. Each provider has a
  // canonical embed origin (mp4upload's CDN wants www.mp4upload.com, not
  // mp4upload.com or s14.mp4upload.com). Derive the right one from the
  // video URL's host first; fall back to the iframe origin.
  const videoSource = (() => {
    if (!videoUrl) return "";
    try {
      const videoHost = new URL(videoUrl).hostname.toLowerCase();
      let referer: string;
      let origin: string;
      // Direct-MP4 CDNs (mp4upload) serve a progressive file and reject GETs
      // that carry an Origin header — they treat it as a blocked cross-origin
      // fetch. So for those we send ONLY Referer + User-Agent. HLS CDNs
      // (streamwish family, voe) generally want the Origin, so keep it there.
      let sendOrigin = true;
      if (/mp4upload/.test(videoHost)) {
        referer = "https://www.mp4upload.com/";
        origin = "https://www.mp4upload.com";
        sendOrigin = false;
      } else if (/streamwish|hgcloud|wishfast|wishembed|jwembed|hlswish/.test(videoHost)) {
        // streamwish family — keep host but strip subdomain to root
        const root = videoHost.split(".").slice(-2).join(".");
        referer = `https://${root}/`;
        origin = `https://${root}`;
      } else if (/voe\./.test(videoHost)) {
        referer = "https://voe.sx/";
        origin = "https://voe.sx";
      } else if (/dood|ds2play|ds2video|vidply|all3do|doply|dsvplay/.test(videoHost)) {
        // dood CDN binds the tokenized URL to the embed page as Referer and
        // rejects requests that carry an Origin header.
        referer = iframeUrl ? new URL(iframeUrl).origin + "/" : `https://${videoHost}/`;
        origin = "";
        sendOrigin = false;
      } else if (/mycdn\.me|okcdn|ok\.ru/.test(videoHost)) {
        referer = "https://ok.ru/";
        origin = "https://ok.ru";
      } else if (/videa/.test(videoHost)) {
        referer = "https://videa.hu/";
        origin = "https://videa.hu";
        sendOrigin = false;
      } else if (iframeUrl) {
        const iframeOrigin = new URL(iframeUrl).origin;
        referer = iframeOrigin + "/";
        origin = iframeOrigin;
      } else {
        const root = videoHost.split(".").slice(-2).join(".");
        referer = `https://${root}/`;
        origin = `https://${root}`;
      }
      const headers: Record<string, string> = {
        Referer: referer,
        // Must match the scraper WebView UA (ScraperHost.tsx) — these CDNs
        // bind the signed URL to the IP+UA that generated it.
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      };
      if (sendOrigin) headers.Origin = origin;
      // Tell the native player the stream type. expo-video needs
      // contentType:'hls' when the uri has no .m3u8 extension (streamwish /
      // voe / dailymotion hand out tokenized HLS URLs with query strings or
      // no extension) — otherwise ExoPlayer/AVPlayer loads NO video tracks
      // and the direct player shows a blank/dead frame. mp4upload is a
      // progressive .mp4 file.
      const isHls =
        /\.m3u8(\?|$)/i.test(videoUrl) ||
        (/streamwish|hgcloud|wishfast|wishembed|jwembed|hlswish|voe\.|dailymotion|dmcdn|mycdn\.me|okcdn/.test(videoHost) &&
          !/\.mp4(\?|$)/i.test(videoUrl));
      const contentType: "hls" | "progressive" = isHls ? "hls" : "progressive";
      return { uri: videoUrl, headers, contentType };
    } catch {
      return videoUrl;
    }
  })();

  const player = useVideoPlayer(videoSource as any, (p) => {
    if (videoUrl && resumeMs > 0) {
      p.currentTime = resumeMs / 1000;
    }
    if (videoUrl) p.play();
  });

  // Force play on native player when source changes
  useEffect(() => {
    if (!videoUrl || !player) return;
    const tryPlay = () => {
      try { player.play(); } catch {}
    };
    tryPlay();
    const t1 = setTimeout(tryPlay, 500);
    const t2 = setTimeout(tryPlay, 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [videoUrl, player]);

  // Auto-fall back to WebView ONLY if the native player never starts.
  // Once playback begins (currentTime advances past 0 OR duration > 0), we
  // never trigger the fallback again — otherwise transient buffering /
  // seeking reports a 0 currentTime mid-watch and we'd kick the user out
  // to the embed page with ads (which is what they wanted to avoid).
  useEffect(() => {
    if (!videoUrl || !player) return;
    const idx = activeIdx;
    let hasStarted = false;
    let cancelled = false;

    // Poll for "started playing" every 250ms; once we see motion, lock in.
    const watchdog = setInterval(() => {
      try {
        if (player.duration > 0 || player.currentTime > 0) hasStarted = true;
      } catch {}
    }, 250);

    // 14s ceiling: if currentTime is still exactly 0 AND duration is still
    // 0 AND we never saw any motion, the URL is truly unplayable. Fall back
    // to the embed quickly so the user isn't staring at a dead direct player.
    const failTimer = setTimeout(() => {
      if (cancelled) return;
      try {
        if (!hasStarted && player.duration === 0 && player.currentTime === 0) {
          setServers((p) => p.map((srv, i) =>
            i === idx ? { ...srv, status: "webview" as ServerStatus, videoUrl: null } : srv
          ));
        }
      } catch {}
    }, 14000);

    return () => {
      cancelled = true;
      clearInterval(watchdog);
      clearTimeout(failTimer);
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

  // Lock orientation + load progress
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
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
          });
        }
      } catch {}
    }, 5000);
    return () => { if (progressTimer.current) clearInterval(progressTimer.current); };
  }, [isPlaying, player, episode, title, animeTitle, animeHref, url4up, imgParam]);

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
        });
      }
    }, 5000);
    return () => { if (progressTimer.current) clearInterval(progressTimer.current); };
  }, [isWebView, episode, title, animeTitle, animeHref, url4up, imgParam]);

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

  // Resolve the current episode's anime4up sibling URL by episode-number
  // match. Used so loadServers can fetch BOTH sources' servers together
  // instead of letting anime4up pop in late.
  const resolveCurrentUp4Url = useCallback(async (currentHref: string): Promise<string | null> => {
    let resolvedAnime: string | null = animeParam || null;
    if (!resolvedAnime) {
      try {
        const { toAnimeUrl } = require("../../lib/favorites") as typeof import("../../lib/favorites");
        resolvedAnime = toAnimeUrl(currentHref);
      } catch {}
    }
    if (!resolvedAnime) return null;
    try {
      const { fetchEpisodes, fetchEpisodesUp4 } = await import("../../lib/api");

      // Episode number is almost always in the witanime URL (...الحلقة-N).
      // Grab it from there so we can SKIP the extra fetchEpisodes page-scrape
      // entirely — that scrape was the main thing slowing server loading.
      let curNum: number | null = null;
      const m = currentHref.match(/الحلقة[\s\-_]*(\d+)/);
      if (m) curNum = parseInt(m[1], 10);

      // fetchEpisodesUp4 derives the title from the anime slug when passed
      // null, and is cached 24h — so this is usually a fast AsyncStorage hit.
      const up4 = await fetchEpisodesUp4(resolvedAnime, null).catch(() => null);
      if (!up4 || !up4.episodes4up.length) return null;

      // Only fall back to the slower fetchEpisodes scrape if the number
      // wasn't in the URL (rare).
      if (curNum == null) {
        const det = await fetchEpisodes(resolvedAnime).catch(() => null);
        if (det?.data?.episodes) {
          const norm = (u: string) => { try { return decodeURIComponent(u).replace(/\/+$/, ""); } catch { return u.replace(/\/+$/, ""); } };
          curNum = det.data.episodes.find((e) => norm(e.href || "") === norm(currentHref))?.number ?? null;
        }
      }
      if (curNum == null) return null;
      const found = up4.episodes4up.find((e) => e.number === curNum)?.href ?? null;
      if (found) setCurrentUp4Href(found);
      return found;
    } catch {
      return null;
    }
  }, [animeParam]);

  // ── LOAD SERVERS ──
  const loadServers = useCallback(async () => {
    if (!episode) return;
    setLoading(true);
    setError(null);
    setServers([]);
    try {
      const url = decodeURIComponent(episode);
      const u4Param = url4up ? decodeURIComponent(url4up) : undefined;
      const isUp4 = /anime4up/i.test(url);

      let res: any = null;
      if (u4Param || isUp4) {
        // url4up already known (or the episode is itself an anime4up one):
        // one combined fetch scrapes both sources in parallel internally.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            res = await fetchVideoServers(url, u4Param);
            if (res.success && res.data.servers.length > 0) break;
          } catch {}
          if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
        }
      } else {
        // No url4up param. Show the witanime servers as fast as possible and
        // enrich anime4up in the BACKGROUND (the append effect handles that
        // via currentUp4Href) — never block the list on the slow cross-source
        // lookup, which is what made loading feel sluggish.
        let witRes = await fetchVideoServers(url, undefined).catch(() => null);
        if (!witRes?.success || !witRes.data.servers.length) {
          await new Promise((r) => setTimeout(r, 1200));
          witRes = await fetchVideoServers(url, undefined).catch(() => null);
        }
        res = witRes;

        // Kick off anime4up enrichment without awaiting it.
        const harvested = witRes?.data?.up4EpisodeUrl;
        if (harvested) {
          // Direct link from the witanime page — fast, no title search needed.
          setCurrentUp4Href(harvested);
        } else {
          // Fall back to the title/episode-number lookup, but fire-and-forget
          // so it can't delay showing the witanime servers.
          void resolveCurrentUp4Url(url).catch(() => null);
        }
      }

      if (!res?.success || !res.data.servers.length) {
        setError(t.noServersFound);
        return;
      }

      // Sort by provider quality
      const sorted = [...res.data.servers].sort((a, b) => {
        const pa = PROVIDER_RANK[a.provider] ?? 5;
        const pb = PROVIDER_RANK[b.provider] ?? 5;
        if (pa !== pb) return pa - pb;
        return qualityScore(b.name) - qualityScore(a.name);
      });

      const states: ServerState[] = sorted.map((s) => ({
        server: s,
        status: "idle" as ServerStatus,
        videoUrl: null,
      }));
      setServers(states);
      setTitle(res.data.episodeTitle || "");
      setAnimeTitle(res.data.animeTitle || "");
      setAnimeHref(res.data.animeHref || "");
      setNextEpisodeHref(nextEpParam || res.data.navigation?.next || null);
      setPrevEpisodeHref(prevEpParam || res.data.navigation?.prev || null);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [episode, url4up, resolveCurrentUp4Url]);

  useEffect(() => { loadServers(); }, [loadServers]);

  // Derive prev/next from the parent anime when not passed in URL params.
  // Triggers when:
  //   - user came from "حلقات جديدة" modal (anime URL is passed)
  //   - user came from continue-watching history (anime URL might not be set)
  //   - user opened an episode link directly
  // For the no-anime-param case we fall back to deriving the anime URL
  // from the episode slug (strip الحلقة-N tail + swap /episode/→/anime/).
  useEffect(() => {
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

  // Resolve the anime4up sibling URLs for prev/next so switching episodes
  // from the player keeps the cross-source servers. Matches by episode
  // number against the anime4up episode list (fetchEpisodesUp4).
  useEffect(() => {
    if (!episode) return;
    setCurrentUp4Href(null);
    const currentHref = decodeURIComponent(episode);
    if (/anime4up/i.test(currentHref)) return; // primary is already anime4up
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
        const { fetchEpisodes, fetchEpisodesUp4 } = await import("../../lib/api");
        const det = await fetchEpisodes(resolvedAnime!).catch(() => null);
        const up4 = await fetchEpisodesUp4(resolvedAnime!, det?.data?.title ?? null).catch(() => null);
        if (cancelled || !up4 || !up4.episodes4up.length) return;
        // Determine current episode number.
        let curNum: number | null = null;
        const m = currentHref.match(/الحلقة[\s\-_]*(\d+)/);
        if (m) curNum = parseInt(m[1], 10);
        if (curNum == null && det?.data?.episodes) {
          const norm = (u: string) => { try { return decodeURIComponent(u).replace(/\/+$/, ""); } catch { return u.replace(/\/+$/, ""); } };
          curNum = det.data.episodes.find((e) => norm(e.href || "") === norm(currentHref))?.number ?? null;
        }
        if (curNum == null) return;
        const byNum = [...up4.episodes4up].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
        setCurrentUp4Href(byNum.find((e) => e.number === curNum)?.href ?? null);
        setNextUp4Href(byNum.find((e) => e.number === curNum! + 1)?.href ?? null);
        setPrevUp4Href(byNum.find((e) => e.number === curNum! - 1)?.href ?? null);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [episode, animeParam]);

  // ── APPEND anime4up servers ──
  // When the episode was opened without a url4up param (home, history, hero,
  // or before detail-page enrichment finished), the initial server fetch only
  // had the witanime servers. Once we resolve the current episode's anime4up
  // URL, scrape its servers and append them — without disturbing the already
  // playing/selected witanime server.
  const appendedUp4Ref = useRef<string | null>(null);
  useEffect(() => {
    if (!currentUp4Href || url4up) return; // url4up param path already merged them
    if (servers.length === 0) return; // wait for the primary servers first
    if (appendedUp4Ref.current === currentUp4Href) return; // already appended
    if (servers.some((s) => s.server.source === "anime4up")) return;
    appendedUp4Ref.current = currentUp4Href;

    let cancelled = false;
    (async () => {
      const res = await fetchVideoServers(currentUp4Href, undefined).catch(() => null);
      if (cancelled || !res?.success || !res.data.servers.length) return;
      setServers((prev) => {
        const seen = new Set(prev.map((s) => s.server.iframeUrl));
        const additions: ServerState[] = res.data.servers
          .filter((s) => s.iframeUrl && !seen.has(s.iframeUrl))
          .map((s) => ({
            server: { ...s, source: "anime4up" },
            status: "idle" as ServerStatus,
            videoUrl: null,
          }));
        return additions.length ? [...prev, ...additions] : prev;
      });
    })();
    return () => { cancelled = true; };
  }, [currentUp4Href, url4up, servers.length]);

  // ── PRE-RESOLVE servers ──
  // Resolves fast providers (mp4upload) in parallel, streamwish serially (Chrome bottleneck).
  // Limited to the top-ranked few so the active server isn't starved of WebView
  // slots; the rest resolve on demand when selected.
  useEffect(() => {
    if (servers.length === 0) return;
    const idxs = servers
      .map((s, i) => (s.status === "idle" ? i : -1))
      .filter((i) => i !== -1)
      .slice(0, 4);
    if (idxs.length === 0) return;

    // Split: streamwish goes through Chrome, others go through HTTP
    const swIndices = idxs.filter((i) => servers[i].server.provider === "streamwish");
    const fastIndices = idxs.filter((i) => servers[i].server.provider !== "streamwish");

    // Resolve fast providers in parallel (2 at a time)
    let fastActive = 0;
    const fastQueue = [...fastIndices];
    const fastNext = () => {
      if (fastQueue.length === 0) return;
      if (fastActive >= 2) return;
      const idx = fastQueue.shift()!;
      fastActive++;
      const srv = servers[idx].server;
      const url = getIframeUrl(srv);
      if (!url) {
        setServers((p) => p.map((s, i) => (i === idx ? { ...s, status: "failed" } : s)));
        fastActive--; fastNext();
        return;
      }
      resolveVideo(url, srv.provider)
        .then((r) => updateServer(idx, r))
        .catch(() => setServers((p) => p.map((s, i) =>
          i === idx ? { ...s, status: "webview" } : s)))
        .finally(() => { fastActive--; fastNext(); });
    };
    fastNext(); fastNext();

    // Resolve streamwish ONE AT A TIME with retry
    const swQueue = [...swIndices];
    const swNext = () => {
      if (swQueue.length === 0) return;
      const idx = swQueue.shift()!;
      const srv = servers[idx].server;
      const url = getIframeUrl(srv);
      if (!url) {
        setServers((p) => p.map((s, i) => (i === idx ? { ...s, status: "failed" } : s)));
        swNext();
        return;
      }
      const tryResolve = (attempt: number) => {
        resolveVideo(url, srv.provider).then((r) => {
          if (r.success && r.data?.videoUrl) {
            updateServer(idx, r);
            swNext();
          } else if (attempt < 2) {
            // Retry after 3s delay
            setTimeout(() => tryResolve(attempt + 1), 3000);
          } else {
            setServers((p) => p.map((s, i) =>
              i === idx ? { ...s, status: "failed" } : s));
            swNext();
          }
        }).catch(() => {
          if (attempt < 2) {
            setTimeout(() => tryResolve(attempt + 1), 3000);
          } else {
            setServers((p) => p.map((s, i) =>
              i === idx ? { ...s, status: "failed" } : s));
            swNext();
          }
        });
      };
      tryResolve(0);
    };
    swNext(); // Only ONE streamwish at a time
  }, [servers.length]);

  // Helper to update a server state
  const updateServer = useCallback((idx: number, r: { success: boolean; data?: { videoUrl: string } }) => {
    if (r.success && r.data?.videoUrl) {
      setServers((p) => p.map((s, i) =>
        i === idx ? { ...s, status: "playing", videoUrl: getProxyUrl(r.data!.videoUrl) } : s));
    } else {
      setServers((p) => p.map((s, i) =>
        i === idx ? { ...s, status: "webview" } : s));
    }
  }, [servers]);

  // ── RESOLVE ACTIVE SERVER (fallback if not pre-resolved) ──
  useEffect(() => {
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
    setServers((p) => p.map((s, i) => i === idx ? { ...s, status: "resolving" } : s));

    // Try server-side HTTP resolution to get direct video URL.
    // priority=true → this user-selected server jumps ahead of any
    // background pre-resolve jobs still in the scraper queue.
    resolveVideo(url, srv.provider, true)
      .then((r) => {
        if (r.success && r.data?.videoUrl) {
          setServers((p) => p.map((s, i) =>
            i === idx ? { ...s, status: "playing", videoUrl: getProxyUrl(r.data!.videoUrl) } : s));
        } else if (srv.provider === "streamwish") {
          setServers((p) => p.map((s, i) =>
            i === idx ? { ...s, status: "failed" } : s));
        } else {
          setServers((p) => p.map((s, i) =>
            i === idx ? { ...s, status: "webview" } : s));
        }
      })
      .catch(() => {
        if (srv.provider === "streamwish") {
          setServers((p) => p.map((s, i) =>
            i === idx ? { ...s, status: "failed" } : s));
        } else {
          setServers((p) => p.map((s, i) =>
            i === idx ? { ...s, status: "webview" } : s));
        }
      });
  }, [activeIdx, servers.length > 0 ? servers[activeIdx]?.status : null]);

  // Auto-advance to next server on failure
  useEffect(() => {
    if (servers.length === 0) return;
    const state = servers[activeIdx];
    if (state?.status !== "failed") return;
    const next = servers.findIndex((s, i) => i !== activeIdx && (s.status === "idle" || s.status === "playing" || s.status === "webview"));
    if (next !== -1) setActiveIdx(next);
  }, [servers, activeIdx]);

  const selectServer = useCallback((idx: number) => {
    setActiveIdx(idx);
    setPickerOpen(false);
  }, []);

  // Skip +/- 10s
  const skipBack = useCallback(() => {
    if (isPlaying && player) {
      try { player.currentTime = Math.max(0, player.currentTime - 10); } catch {}
    } else if (isWebView) {
      webViewRef.current?.injectJavaScript(`
        try{var v=document.querySelector('video');if(v)v.currentTime=Math.max(0,v.currentTime-10);
        else if(typeof jwplayer==='function'){var p=jwplayer();if(p)p.seek(Math.max(0,p.getPosition()-10));}
        }catch(e){}
      `);
    }
  }, [isPlaying, isWebView, player]);

  const skipForward = useCallback(() => {
    if (isPlaying && player) {
      try { player.currentTime = Math.min(player.currentTime + 10, player.duration || Infinity); } catch {}
    } else if (isWebView) {
      webViewRef.current?.injectJavaScript(`
        try{var v=document.querySelector('video');if(v)v.currentTime=Math.min(v.duration,v.currentTime+10);
        else if(typeof jwplayer==='function'){var p=jwplayer();if(p)p.seek(Math.min(p.getDuration(),p.getPosition()+10));}
        }catch(e){}
      `);
    }
  }, [isPlaying, isWebView, player]);

  const skipForward90 = useCallback(() => {
    if (isPlaying && player) {
      try { player.currentTime = Math.min(player.currentTime + 90, player.duration || Infinity); } catch {}
    } else if (isWebView) {
      webViewRef.current?.injectJavaScript(`
        try{var v=document.querySelector('video');if(v)v.currentTime=Math.min(v.duration,v.currentTime+90);
        else if(typeof jwplayer==='function'){var p=jwplayer();if(p)p.seek(Math.min(p.getDuration(),p.getPosition()+90));}
        }catch(e){}
      `);
    }
  }, [isPlaying, isWebView, player]);

  // Next episode — carry cross-source url4up + anime context so the
  // anime4up servers keep showing on the next episode.
  const goNextEpisode = useCallback(() => {
    if (!nextEpisodeHref) return;
    router.replace({
      pathname: `/watch/${encodeURIComponent(nextEpisodeHref)}`,
      params: {
        url4up: nextUp4Href || "",
        anime: animeParam || "",
        img: imgParam || "",
      },
    });
  }, [nextEpisodeHref, nextUp4Href, animeParam, imgParam]);

  // Previous episode
  const goPrevEpisode = useCallback(() => {
    if (!prevEpisodeHref) return;
    router.replace({
      pathname: `/watch/${encodeURIComponent(prevEpisodeHref)}`,
      params: {
        url4up: prevUp4Href || "",
        anime: animeParam || "",
        img: imgParam || "",
      },
    });
  }, [prevEpisodeHref, prevUp4Href, animeParam, imgParam]);

  // Resize mode toggle
  // contain: fits whole video (may have black bars on non-16:9 sources)
  // fill:    stretches to use every pixel of the screen (slight distortion
  //          but NO content is cut off — what most users want for "fullscreen")
  const [videoFit, setVideoFit] = useState<"contain" | "fill">("contain");

  // Custom player state
  const [isPlayerPaused, setIsPlayerPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekValue, setSeekValue] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);

  // Poll player state every 500ms
  useEffect(() => {
    if (!isPlaying || !player) return;
    const iv = setInterval(() => {
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
    }, 500);
    return () => clearInterval(iv);
  }, [isPlaying, player, isSeeking, seekValue]);

  // Playback speed
  const cycleSpeed = useCallback(() => {
    setSpeedIdx((i) => (i + 1) % SPEEDS.length);
  }, []);
  useEffect(() => {
    if (!player) return;
    try { player.playbackRate = SPEEDS[speedIdx]; } catch {}
  }, [speedIdx, player, videoUrl]);

  const togglePlayPause = useCallback(() => {
    if (!player) return;
    try {
      if (isPlayerPaused) {
        player.play();
        setIsPlayerPaused(false);
      } else {
        player.pause();
        setIsPlayerPaused(true);
      }
    } catch {}
  }, [player, isPlayerPaused]);

  const seekBarRef = useRef<View>(null);

  const onSeekPress = useCallback((e: any) => {
    if (!player || duration <= 0) return;
    try {
      const loc = e.nativeEvent.locationX;
      seekBarRef.current?.measure((_x, _y, w) => {
        const ratio = Math.max(0, Math.min(1, loc / w));
        player.currentTime = ratio * duration;
        setSeekValue(ratio);
        setCurrentTime(ratio * duration);
        if (!isPlayerPaused) player.play();
      });
    } catch {}
  }, [player, duration, isPlayerPaused]);

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

  // ── RENDER ──

  if (loading) {
    return (
      <View style={ss.root}>
        <StatusBar hidden />
        <View style={ss.centered}>
          <ActivityIndicator size="large" color={C.green} />
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
            <Pressable onPress={loadServers} style={ss.actionBtn}>
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
              <ActivityIndicator size="large" color={C.green} />
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
          <ActivityIndicator size="large" color={C.green} />
          <Text style={ss.statusText}>Connecting...</Text>
          <Text style={ss.statusSub}>{active ? getDisplayName(active.server) : ""}</Text>
        </View>
      ) : allFailed ? (
        <View style={[ss.player, ss.centered]}>
          <Ionicons name="cloud-offline-outline" size={48} color={C.textMuted} />
          <Text style={ss.statusText}>All servers failed</Text>
          <Pressable onPress={loadServers} style={ss.actionBtn}>
            <Ionicons name="refresh" size={16} color={C.white} />
            <Text style={ss.actionBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[ss.player, ss.centered]}>
          <ActivityIndicator size="large" color={C.green} />
          <Text style={ss.statusText}>Preparing...</Text>
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
      {isPlaying && !pickerOpen && !controlsVisible && (
        <Pressable
          style={[StyleSheet.absoluteFill, { zIndex: 2 }]}
          onPress={showControls}
        />
      )}

      {/* Buffering spinner — floats above the video even when chrome is hidden */}
      {isPlaying && isBuffering && !controlsVisible && (
        <View style={ss.bufferOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={C.accent} />
        </View>
      )}

      {/* Custom Controls Overlay */}
      {isPlaying && !pickerOpen && controlsVisible && (
        <View style={ss.controlsOverlay} pointerEvents="box-none">
          {/* Tap on empty space hides the chrome */}
          <Pressable style={StyleSheet.absoluteFill} onPress={tapToToggle} />
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
            <View style={ss.titleArea} pointerEvents="none">
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
            </View>
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
              <View ref={seekBarRef} style={ss.seekBarWrap} collapsable={false}>
                <View style={ss.seekTrack}>
                  <View style={[ss.seekFill, { width: `${Math.min(seekValue * 100, 100)}%` }]} />
                </View>
                <View
                  style={[ss.seekThumb, { left: `${Math.min(seekValue * 100, 100)}%` }]}
                  pointerEvents="none"
                />
                <Pressable style={ss.seekTouchArea} onPress={onSeekPress} />
              </View>
              <Text style={ss.timeTextDur}>{fmtTime(duration)}</Text>
            </View>

            <View style={ss.ctrlRow}>
              <Pressable onPress={skipForward90} style={ss.chipBtn}>
                <Ionicons name="play-forward-circle-outline" size={16} color={C.white} />
                <Text style={ss.chipBtnText}>+90s</Text>
              </Pressable>

              <View style={{ flexDirection: "row", gap: 8 }}>
                {prevEpisodeHref && (
                  <Pressable onPress={goPrevEpisode} style={ss.chipBtn}>
                    <Ionicons name="play-skip-back" size={14} color={C.white} />
                    <Text style={ss.chipBtnText}>Prev</Text>
                  </Pressable>
                )}
                {nextEpisodeHref && (
                  <Pressable onPress={goNextEpisode} style={ss.chipBtnAccent}>
                    <Text style={ss.chipBtnAccentText}>Next Episode</Text>
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
            <View style={ss.titleArea}>
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
            </View>
            <Pressable onPress={skipForward} style={ss.iconBtn} hitSlop={6}>
              <Ionicons name="play-forward" size={18} color={C.white} />
            </Pressable>
            {nextEpisodeHref && (
              <Pressable onPress={goNextEpisode} style={[ss.iconBtn, ss.iconBtnAccent]} hitSlop={6}>
                <Ionicons name="play-skip-forward" size={18} color={C.white} />
              </Pressable>
            )}
            <Pressable onPress={() => setPickerOpen(true)} style={ss.iconBtn} hitSlop={6}>
              <Ionicons name="server-outline" size={18} color={C.white} />
            </Pressable>
          </View>
        </View>
      )}

      {/* SERVER PICKER */}
      {pickerOpen && (
        <View style={ss.pickerOverlay}>
          <Pressable style={ss.pickerBackdrop} onPress={() => setPickerOpen(false)} />
          <View style={[ss.pickerSheet, { paddingTop: (insets.top || 10) + 10 }]}>
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
              <Pressable onPress={() => setPickerOpen(false)} style={ss.iconBtn} hitSlop={6}>
                <Ionicons name="close" size={20} color={C.white} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={ss.pickerScroll} contentContainerStyle={ss.pickerContent}>
              {servers.map((item, index) => {
                const isActive = index === activeIdx;
                const color = item.status === "playing" ? "#00E676"
                  : item.status === "webview" ? C.cyan
                  : item.status === "failed" ? "#FF5252"
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
                    onPress={() => selectServer(index)}
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
                      <Ionicons name="flash" size={14} color="#00E676" />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  player: { flex: 1, backgroundColor: "#000" },
  playerWrap: { flex: 1 },

  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-start", zIndex: 3 },

  // Status / error states
  statusText: { color: "rgba(255,255,255,0.85)", fontSize: 15, fontWeight: "700", textAlign: "center", paddingHorizontal: 32, fontFamily: "Outfit_700Bold" },
  statusSub: { color: "rgba(255,255,255,0.45)", fontSize: 12, textAlign: "center", fontFamily: "DMSans_500Medium" },
  errorTitle: { color: "rgba(255,255,255,0.7)", fontSize: 16, fontWeight: "700", marginTop: 8, textAlign: "center", paddingHorizontal: 32, fontFamily: "Outfit_700Bold" },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.accent, borderRadius: 24, paddingHorizontal: 22, paddingVertical: 11,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 6,
  },
  actionBtnText: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Outfit_700Bold" },

  // Gradient scrims
  gradTop: { position: "absolute", top: 0, left: 0, right: 0, height: 120 },
  gradBottom: { position: "absolute", bottom: 0, left: 0, right: 0, height: 150 },
  topBarGrad: { position: "absolute", top: 0, left: 0, right: 0, height: 110 },

  // Controls overlay
  controlsOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: "space-between", zIndex: 3 },
  bufferOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", zIndex: 2 },

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
    backgroundColor: "rgba(255,45,85,0.25)",
    borderColor: "rgba(255,45,85,0.5)",
  },
  speedBtn: {
    height: 38, minWidth: 48, borderRadius: 19, paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  speedBtnText: { color: C.white, fontSize: 12, fontWeight: "800", fontFamily: "Outfit_800ExtraBold", letterSpacing: 0.3 },
  titleArea: { flex: 1, gap: 3 },
  titleText: {
    color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Outfit_700Bold",
    textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 6,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  directPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(0,230,118,0.15)", borderWidth: 1, borderColor: "rgba(0,230,118,0.35)",
    borderRadius: 100, paddingHorizontal: 8, paddingVertical: 2,
  },
  directPillText: { color: "#00E676", fontSize: 8, fontWeight: "800", letterSpacing: 1, fontFamily: "Outfit_800ExtraBold" },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#00E676" },
  serverLabelText: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontFamily: "DMSans_500Medium", flexShrink: 1 },

  // Center cluster
  centerCluster: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 44,
  },
  playBtn: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: "rgba(255,45,85,0.9)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.25)",
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 24, elevation: 10,
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
    color: "#fff", fontSize: 12, fontWeight: "700", minWidth: 42, textAlign: "center",
    fontFamily: "Outfit_700Bold", fontVariant: ["tabular-nums"],
  },
  timeTextDur: {
    color: "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: "600", minWidth: 42, textAlign: "center",
    fontFamily: "Outfit_600SemiBold", fontVariant: ["tabular-nums"],
  },
  seekBarWrap: { flex: 1, height: 32, justifyContent: "center" },
  seekTrack: { height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden" },
  seekFill: { height: 4, borderRadius: 2, backgroundColor: C.accent },
  seekThumb: {
    position: "absolute", top: 9, marginLeft: -7,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: C.accent, borderWidth: 2, borderColor: "#fff",
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8, elevation: 4,
  },
  seekTouchArea: { ...StyleSheet.absoluteFillObject },
  ctrlRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chipBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 100, paddingHorizontal: 14, paddingVertical: 8,
  },
  chipBtnText: { color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Outfit_600SemiBold" },
  chipBtnAccent: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.accent,
    borderRadius: 100, paddingHorizontal: 16, paddingVertical: 8,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 14, elevation: 6,
  },
  chipBtnAccentText: { color: "#fff", fontSize: 12, fontWeight: "800", fontFamily: "Outfit_700Bold" },

  // Server picker
  pickerOverlay: { ...StyleSheet.absoluteFillObject, flexDirection: "row", zIndex: 10 },
  pickerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)" },
  pickerSheet: {
    width: "58%", backgroundColor: "#0B0C1E",
    paddingHorizontal: 16, paddingBottom: 16,
    borderTopLeftRadius: 24, borderBottomLeftRadius: 24,
    borderLeftWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  pickerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  pickerHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  pickerHeaderIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "rgba(255,45,85,0.14)", borderWidth: 1, borderColor: "rgba(255,45,85,0.3)",
    alignItems: "center", justifyContent: "center",
  },
  pickerTitle: { color: "#fff", fontSize: 17, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  pickerSub: { color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 1, fontFamily: "DMSans_500Medium" },
  pickerScroll: { flex: 1 },
  pickerContent: { gap: 7, paddingBottom: 20 },

  serverItem: {
    flexDirection: "row", alignItems: "center", gap: 11,
    paddingVertical: 10, paddingHorizontal: 11, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.05)",
  },
  serverItemActive: {
    backgroundColor: "rgba(255,45,85,0.12)",
    borderColor: "rgba(255,45,85,0.45)",
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
    borderWidth: 2, borderColor: "#0B0C1E",
  },
  serverInfo: { flex: 1 },
  serverName: { color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Outfit_600SemiBold" },
  serverNameActive: { color: C.accent },
  serverMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  serverMetaLabel: { fontSize: 10, fontWeight: "700", fontFamily: "DMSans_600SemiBold" },
  serverMeta: { color: "rgba(255,255,255,0.35)", fontSize: 10, fontFamily: "DMSans_500Medium", flexShrink: 1 },
  activeBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: C.accent, borderRadius: 100, paddingHorizontal: 8, paddingVertical: 3,
  },
  activeBadgeText: { color: "#fff", fontSize: 8, fontWeight: "800", letterSpacing: 0.8, fontFamily: "Outfit_800ExtraBold" },
});
