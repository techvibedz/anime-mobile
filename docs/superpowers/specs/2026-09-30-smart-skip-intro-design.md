# Smart Skip Intro & Outro (OP / ED Skip) Specification

## Goal
Provide a seamless, smart "Skip Intro / Skip Outro" experience for anime episodes in the player using the public AniSkip API, coupled with configurable auto-skip preferences, a manual "+85s" quick-jump fallback, and full Arabic/RTL UI localization.

---

## 1. System Architecture

```mermaid
flowchart TD
    Player["Player (app/watch/[episode].tsx)"]
    Settings["Settings (lib/settings.ts)"]
    AniSkip["AniSkip API (lib/aniskip.ts)"]
    Info["Anime Info / MAL Resolver (lib/animeInfo.ts)"]
    Cache["AsyncStorage (@aniskip_v1:*)"]

    Player -->|1. Request skip times (animeTitle, episodeNum)| AniSkip
    AniSkip -->|2. Resolve MAL ID| Info
    AniSkip -->|3. Check Cache| Cache
    AniSkip -->|4. If miss, fetch remote| AniSkipAPI["https://api.aniskip.com"]
    AniSkip -->|5. Return { op, ed, found }| Player
    Player -->|6. Check Auto-Skip toggle| Settings
```

### Components:
1. **`lib/aniskip.ts`**:
   - `SkipInterval`: `{ startTime: number, endTime: number }`
   - `EpisodeSkipTimes`: `{ op?: SkipInterval, ed?: SkipInterval, found: boolean }`
   - `fetchSkipTimes(malId: number, episodeNumber: number, duration?: number): Promise<EpisodeSkipTimes>`
   - `getOrResolveMalId(animeTitle: string, animeSlug?: string): Promise<number | null>`
   - `getSkipTimesForEpisode(animeTitle: string, episodeNumber: number, animeSlug?: string, duration?: number): Promise<EpisodeSkipTimes>`
   - Multi-tier caching: In-memory Map for active session + `AsyncStorage` with 14-day TTL.

2. **`lib/settings.ts` & `app/settings.tsx`**:
   - Setting: `getAutoSkipIntro(): Promise<boolean>`
   - Setting: `setAutoSkipIntro(enabled: boolean): Promise<void>`
   - Default: `false` (shows manual floating button during OP/ED; user can toggle to `true` for auto-skipping).
   - In Settings UI: Dedicated switch *"تخطي الشارة تلقائياً"* with explanation *"تخطي شارات البداية والنهاية تلقائياً عند توفر التوقيت"*.

3. **`app/watch/[episode].tsx`**:
   - Time observer in `useVideoPlayer` / playback position hook:
     - Detects if `currentTime` is within `[op.startTime, op.endTime]` or `[ed.startTime, ed.endTime]`.
     - If `autoSkipIntro` is `true`: calls `player.seekBy(...)` or `player.currentTime = interval.endTime` once per interval, with a brief HUD banner (*"تم تخطي شارة البداية"* / *"تم تخطي شارة النهاية"*).
     - If `autoSkipIntro` is `false`: animates a sleek floating glass pill button on top of the player:
       - *"⏩ تخطي شارة البداية"* (Skip Intro)
       - *"⏩ تخطي شارة النهاية"* (Skip Outro)
       - Tapping it seeks to `endTime`.
   - **Fallback (+85s Button)**:
     - When `found === false` or AniSkip returns no interval for the current position, an 85-second fast-forward button (`+85s` / `تخطي 85 ثانية`) is accessible on the player controls bar.

4. **Localization (`lib/i18n.ts`)**:
   - `skipIntro`: "تخطي البداية"
   - `skipOutro`: "تخطي النهاية"
   - `introSkipped`: "تم تخطي شارة البداية"
   - `outroSkipped`: "تم تخطي شارة النهاية"
   - `skip85s`: "+85 ثانية"
   - `settingsAutoSkipIntro`: "تخطي الشارة تلقائياً"
   - `settingsAutoSkipIntroDesc`: "تخطي شارات البداية والنهاية تلقائياً عند توفر التوقيت"

---

## 2. Error Handling & Edge Cases
1. **Network failure / AniSkip timeout**: Graceful timeout after 3 seconds; marks `found: false` without interrupting video buffering.
2. **Episode with no MAL match**: Falls back cleanly to `found: false` and enables the `+85s` manual button.
3. **Double Skip prevention**: Ensure `seekTo` triggers only once per interval when auto-skip is enabled, avoiding seek loops.
4. **Offline / Downloaded Playback**: If timestamps were previously cached, they work offline. If not cached, the `+85s` button remains available.
