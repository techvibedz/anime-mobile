# Smart Skip Intro & Outro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement smart anime intro and outro skipping (OP/ED) using the public AniSkip API, with an auto-skip setting, floating pill buttons during playback, a manual +85s fallback button, and full Arabic UI.

**Architecture:** A dedicated client module `lib/aniskip.ts` resolves MAL IDs and queries AniSkip with persistent caching. `lib/settings.ts` manages the auto-skip preference. `app/watch/[episode].tsx` observes playback time to present a floating skip button or perform an auto-skip with feedback banner.

**Tech Stack:** TypeScript, React Native (Expo SDK 57), expo-video, AsyncStorage, AniSkip API, NativeWind/Tailwind.

---

### Task 1: Add Localization and Auto-Skip Settings

**Files:**
- Modify: `lib/i18n.ts`
- Modify: `lib/settings.ts`
- Test: `lib/settings.test.ts`

- [x] **Step 1: Write test for settings**
- [x] **Step 2: Add strings to `lib/i18n.ts`**
- [x] **Step 3: Implement `getAutoSkipIntro` and `setAutoSkipIntro` in `lib/settings.ts`**
- [x] **Step 4: Run test to verify**

---

### Task 2: Implement AniSkip Client & Resolver (`lib/aniskip.ts`)

**Files:**
- Create: `lib/aniskip.ts`
- Create: `lib/aniskip.test.ts`

- [x] **Step 1: Write unit tests in `lib/aniskip.test.ts` mocking AniSkip responses and caching**
- [x] **Step 2: Implement `lib/aniskip.ts` with parsing, timeout handling, and AsyncStorage caching**
- [x] **Step 3: Run `npx tsx lib/aniskip.test.ts` to verify**

---

### Task 3: Add Auto-Skip Setting in Settings Screen

**Files:**
- Modify: `app/settings.tsx`

- [x] **Step 1: Add state and toggle switch for `autoSkipIntro` in `app/settings.tsx`**
- [x] **Step 2: Test rendering and settings persistence**

---

### Task 4: Integrate Skip Intro/Outro in Video Player (`app/watch/[episode].tsx`)

**Files:**
- Modify: `app/watch/[episode].tsx`

- [x] **Step 1: Fetch skip intervals on episode load**
- [x] **Step 2: Detect active interval during playback**
- [x] **Step 3: Handle Auto-Skip (with toast indicator) and Manual Skip floating pill**
- [x] **Step 4: Add manual '+85s' fallback button in controls**

---

### Task 5: Full Test Suite Verification & Code Quality

**Files:**
- Modify: `package.json` (add aniskip test to `npm test`)

- [x] **Step 1: Run TypeScript check (`npx tsc --noEmit`)**
- [x] **Step 2: Run all test scripts (`npm test`)**

---

### Task 6: OTA Update / App Release Verification

- [ ] **Step 1: Check OTA scripts or run build verification**
