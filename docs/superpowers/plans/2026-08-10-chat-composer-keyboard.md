# Chat Composer Keyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep both chat composers flush with the keyboard while open, restore their safe-area position when closed, and improve control contrast.

**Architecture:** Retain each screen's existing `KeyboardAvoidingView` and keyboard listener. Add one local keyboard-visible boolean per screen, update it from show/hide events, and conditionally include the bottom safe-area inset. Reuse existing theme tokens for the approved colors.

**Tech Stack:** Expo 54, React Native 0.81, TypeScript, React Native `Keyboard`, safe-area-context

---

### Task 1: User Chat Composer

**Files:**
- Modify: `app/chat.tsx`

- [ ] Add `keyboardVisible` state beside the existing composer state.
- [ ] Update the existing keyboard effect to set the state on show, scroll to the newest message, and reset the state on hide.
- [ ] Change composer bottom padding to `8` while open and `insets.bottom + 8` while closed.
- [ ] Use `C.surfaceLight` for the input and `C.mintSoft`, `C.mint`, and `C.mint` for the camera background, border, and icon.

### Task 2: Admin Chat Composer

**Files:**
- Modify: `app/admin/chat/[id].tsx`

- [ ] Apply the same state, listeners, conditional padding, and color tokens as the user chat.
- [ ] Confirm user and admin composer implementations remain behaviorally identical.

### Task 3: Verification And Preview OTA

**Files:**
- Inspect: `app/chat.tsx`
- Inspect: `app/admin/chat/[id].tsx`

- [ ] Run `npm test`; expect all checks to pass, except any documented pre-existing failure must be reported separately.
- [ ] Run `git diff --check -- app/chat.tsx app/admin/chat/[id].tsx`; expect no whitespace errors.
- [ ] Inspect `git diff -- app/chat.tsx app/admin/chat/[id].tsx` and confirm only intended chat changes are included alongside the pre-existing edits in those files.
- [ ] Publish with `BRANCHES=preview npm run publish-ota -- "Fix chat composer keyboard position and contrast"`.
- [ ] Confirm EAS reports successful Android preview updates.
