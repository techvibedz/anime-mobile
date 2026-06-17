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
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

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
