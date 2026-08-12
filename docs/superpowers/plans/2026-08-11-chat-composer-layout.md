# Chat Composer Layout Implementation Plan

> **Execution:** Inline only. The user explicitly prohibited subagents.

**Goal:** Correct both chat composers and their first-focus Android keyboard behavior, then publish the verified change to the latest preview runtime.

**Architecture:** Keep the existing duplicated composer implementation and apply the same minimal style and child-order changes in both screens. No component extraction is justified for this narrow fix.

**Tech Stack:** Expo 54, React Native 0.81, TypeScript, EAS Update

---

### Task 1: Correct Both Composer Layouts

**Files:**
- Modify: `app/chat.tsx:223-273,337-365`
- Modify: `app/admin/chat/[id].tsx:302-351,424-452`

- [ ] Reorder each composer child sequence to Send, Photo, input.
- [ ] Use an explicit LTR normal row with child order input, Photo, Send so Send is physically outer-right.
- [ ] Set both controls and input minimum height to 52px.
- [ ] Apply the existing mint-soft, mint-border style to both controls.
- [ ] Use 14px between Send and Photo, then 18px between Photo and the input.

### Task 2: Remove The Android Keyboard Race

**Files:**
- Modify: `app/chat.tsx:1-105,154-158,225`
- Modify: `app/admin/chat/[id].tsx:1-140,240-244,303`

- [ ] Remove the `Keyboard` import, `keyboardVisible` state, and keyboard listener effect.
- [ ] Use `padding` keyboard avoidance on Android and iOS without delayed keyboard listeners.
- [ ] Restore stable safe-area bottom padding without waiting for a keyboard event.

### Task 3: Verify And Publish

**Files:**
- Verify: `app/chat.tsx`
- Verify: `app/admin/chat/[id].tsx`

- [ ] Run `npx tsc --noEmit` and require exit code 0.
- [ ] Run `node .agents/skills/impeccable/scripts/detect.mjs --json --scope layout app/chat.tsx app/admin/chat/[id].tsx` and review findings.
- [ ] Publish directly to the `preview` branch with `OTA_RUNTIME=3.3.1` and confirm EAS reports a successful update.
