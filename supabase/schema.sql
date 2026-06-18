-- Pantoufa mobile app — Supabase schema
-- Apply via Supabase dashboard → SQL Editor, or `supabase db push`.

-- ── favorites: user's "My List" entries (Watching / Plan to Watch) ────
create table if not exists public.favorites (
  user_id   uuid not null references auth.users(id) on delete cascade,
  href      text not null,
  title     text not null,
  image     text,
  list      text not null check (list in ('watching', 'planned')),
  added_at  timestamptz not null default now(),
  primary key (user_id, href)
);

alter table public.favorites enable row level security;

create policy "favorites_select_own" on public.favorites
  for select using (auth.uid() = user_id);
create policy "favorites_insert_own" on public.favorites
  for insert with check (auth.uid() = user_id);
create policy "favorites_update_own" on public.favorites
  for update using (auth.uid() = user_id);
create policy "favorites_delete_own" on public.favorites
  for delete using (auth.uid() = user_id);

create index if not exists favorites_user_added_idx
  on public.favorites (user_id, added_at desc);

-- ── watch_history: continue-watching progress per episode ────────────
create table if not exists public.watch_history (
  user_id        uuid not null references auth.users(id) on delete cascade,
  episode_href   text not null,
  episode_title  text not null,
  anime_title    text not null,
  anime_href     text not null,
  image          text,
  position_ms    bigint not null default 0,
  duration_ms    bigint not null default 0,
  url4up         text,
  completed      boolean not null default false,
  dismissed      boolean not null default false,
  updated_at     timestamptz not null default now(),
  primary key (user_id, episode_href)
);

alter table public.watch_history enable row level security;

create policy "history_select_own" on public.watch_history
  for select using (auth.uid() = user_id);
create policy "history_insert_own" on public.watch_history
  for insert with check (auth.uid() = user_id);
create policy "history_update_own" on public.watch_history
  for update using (auth.uid() = user_id);
create policy "history_delete_own" on public.watch_history
  for delete using (auth.uid() = user_id);

create index if not exists history_user_updated_idx
  on public.watch_history (user_id, updated_at desc);
