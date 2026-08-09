# Supabase Egress Reduction

## Goal

Reduce avoidable Supabase database and Auth egress without changing the app's data model, user-visible behavior, local progress-save frequency, or notification delivery logic.

## Root Causes

1. The player saves progress locally every five seconds, and each cloud upsert first calls `auth.getUser()`. That remote user response is unnecessary because the persisted client session already contains the user and RLS validates the access token on the write.
2. Every reporting device upserts the already-known newest episode and invokes `episode-notifier`. Each invocation reads all push tokens, favorites for list-scoped users, and recent queue rows even when no episode was inserted.

## Design

- Add one shared client helper that reads the current user from `auth.getSession()` and use it for routine history, favorites, completion, and notification-setting writes. Keep explicit `auth.getUser()` validation on sensitive profile/report operations.
- Request inserted episode keys from the queue upsert. Invoke `episode-notifier` only when at least one row was actually inserted. Conflict-only reports still update local seen state and return without invoking the function.
- Do not change tables, RLS, scraping, the five-second local save interval, cloud progress write frequency, notification scope, cron behavior, or queue retention.

## Verification

- A focused test proves conflict-only queue reports do not request notifier work while newly inserted rows do.
- TypeScript compilation and the existing test suite pass.
- The final diff contains only the shared session lookup, its routine callers, notifier gating, and the focused test.
