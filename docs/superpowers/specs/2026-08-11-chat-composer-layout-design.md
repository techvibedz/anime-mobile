# Chat Composer Layout Design

## Goal

Improve the user and admin chat composers so their actions are easy to reach, clearly separated, and visually consistent.

## Design

- Use an explicit LTR composer row with source order: text input, Photo, Send. This guarantees Send is physically outer-right regardless of Arabic text direction.
- Use 52px circular action buttons and a 52px minimum input height.
- Separate Send from Photo by 14px and the action group from the input by 18px.
- Give Send and Photo the same mint-soft background, mint border, and mint icon.
- Keep the 52px controls bottom-aligned with the 52px minimum-height input.
- Use `KeyboardAvoidingView` padding on Android and iOS so the composer moves above the keyboard without requiring a native rebuild.
- Keep delayed keyboard visibility state and listeners removed.
- Preserve disabled opacity, loading indicators, accessibility labels, safe-area padding, and all message behavior.

## Files

- `app/chat.tsx`
- `app/admin/chat/[id].tsx`

## Verification

- Run the TypeScript compiler without emitting files.
- Run the Impeccable layout detector on both chat files.
- Publish the verified JavaScript update to runtime `3.3.1` on the EAS `preview` branch.

## Out Of Scope

- Message logic, image upload behavior, chat bubbles, headers, and other screens.
