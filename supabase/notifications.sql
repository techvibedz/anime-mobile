-- Pantoufa — push notification schema (1.4.0)
-- Apply via Supabase dashboard → SQL Editor, or `supabase db push`.
--
-- Powers server-sent episode notifications:
--   push_tokens       — each user's Expo push token(s)
--   anime_mappings    — cache: normalized anime title → AniList id + cover + last-aired episode
--   notified_episodes — per-user dedup so an episode is pushed at most once
--
-- The episode-notifier Edge Function (service role) reads favorites + these
-- tables, queries AniList for newly-aired episodes, and sends Expo push.

-- ── push_tokens ──────────────────────────────────────────────────────
create table if not exists public.push_tokens (
  user_id    uuid not null references auth.users(id) on delete cascade,
  token      text not null,
  platform   text,
  -- Mirror of the on-device notification-scope setting: 'all' = push for every
  -- new episode, 'mylist' = only the user's saved anime. Default 'all' matches
  -- the app default.
  notification_scope text not null default 'all',
  -- Master on/off switch mirroring the on-device "notifications enabled" toggle.
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

-- Migrations for existing deployments (columns added after 1.4.0 ship).
alter table public.push_tokens
  add column if not exists notification_scope text not null default 'all';
-- Master on/off switch (mirrors the on-device "notifications enabled" toggle);
-- the episode-notifier skips tokens with enabled = false.
alter table public.push_tokens
  add column if not exists enabled boolean not null default true;

alter table public.push_tokens enable row level security;

-- A user manages only their own tokens. The Edge Function uses the service
-- role key, which bypasses RLS, so it can read every token.
create policy "push_tokens_select_own" on public.push_tokens
  for select using (auth.uid() = user_id);
create policy "push_tokens_insert_own" on public.push_tokens
  for insert with check (auth.uid() = user_id);
create policy "push_tokens_update_own" on public.push_tokens
  for update using (auth.uid() = user_id);
create policy "push_tokens_delete_own" on public.push_tokens
  for delete using (auth.uid() = user_id);

-- ── anime_mappings (AniList resolution cache) ────────────────────────
-- `key` is the normalized anime title (see norm() in lib/notifications.ts).
-- `last_aired_episode` is the highest episode AniList reports as aired the
-- last time we checked; new episodes are detected when AniList exceeds it.
create table if not exists public.anime_mappings (
  key                text primary key,
  anilist_id         integer,
  title              text,
  image              text,
  last_aired_episode integer not null default 0,
  last_checked       timestamptz,
  not_found          boolean not null default false
);

-- Server-only table — no public access (service role bypasses RLS).
alter table public.anime_mappings enable row level security;

-- ── episode_queue (witanime "recently available" feed) ───────────────
-- The app reports newly-available episodes here (it can scrape witanime via its
-- hidden WebView; the server can't, due to Cloudflare). The episode-notifier
-- fans these out as closed-app push WITH the episode image. Shared/global: any
-- signed-in user keeps it fresh for everyone. Pruned to a short TTL by the fn.
create table if not exists public.episode_queue (
  episode_key    text primary key,        -- `${anime_key}#${episode_number}`
  anime_key      text not null,
  anime_title    text not null default '',
  anime_href     text not null default '',
  episode_title  text,
  episode_href   text,
  episode_number integer not null,
  image          text,
  created_at     timestamptz not null default now()
);

alter table public.episode_queue enable row level security;

-- Any signed-in user may contribute the shared feed (insert only; first write
-- wins via ON CONFLICT DO NOTHING). Service role reads/prunes, bypassing RLS.
create policy "episode_queue_insert_auth" on public.episode_queue
  for insert to authenticated with check (true);

-- REQUIRED for the client upsert: `insert ... on conflict do nothing` (what
-- supabase-js `.upsert({ ignoreDuplicates: true })` emits) needs SELECT on the
-- arbiter index to evaluate the conflict. Without this, every client report
-- failed with 42501 (RLS) and the queue stayed empty → no closed-app push ever
-- fired. The rows are a shared/global feed, so reading them is not sensitive.
create policy "episode_queue_select_auth" on public.episode_queue
  for select to authenticated using (true);

create index if not exists episode_queue_created_idx
  on public.episode_queue (created_at desc);

-- ── notified_episodes (per-user dedup) ───────────────────────────────
create table if not exists public.notified_episodes (
  user_id        uuid not null references auth.users(id) on delete cascade,
  anime_key      text not null,
  episode_number integer not null,
  created_at     timestamptz not null default now(),
  primary key (user_id, anime_key, episode_number)
);

alter table public.notified_episodes enable row level security;
create policy "notified_select_own" on public.notified_episodes
  for select using (auth.uid() = user_id);
