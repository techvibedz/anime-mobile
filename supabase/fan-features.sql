-- Pantoufa fan features (2026-11): AI recap/search caches, anime→manga bridge,
-- episode reactions (hype map), crowdsourced server health, shared moments and
-- the yearly Wrapped share card.
--
-- Security model:
--   * AI caches + server-health buckets: RLS on with NO policies → invisible to
--     clients; only the edge function (service role) or SECURITY DEFINER RPCs
--     touch them.
--   * Reactions: clients insert their own rows; reads go through an aggregate
--     RPC so nobody can list who reacted.
--   * Moments / Wrapped: public read (the web share page uses the anon key),
--     own-row writes, rate limited by triggers.
-- Every SECURITY DEFINER function pins search_path = '' and validates input.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. AI caches (edge function only)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_recap_cache (
  cache_key text primary key check (char_length(cache_key) between 3 and 600),
  answer text not null check (char_length(answer) between 1 and 8000),
  created_at timestamptz not null default now()
);
alter table public.ai_recap_cache enable row level security;

create table if not exists public.ai_search_cache (
  query_key text primary key check (char_length(query_key) between 1 and 400),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 65536),
  created_at timestamptz not null default now()
);
alter table public.ai_search_cache enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Anime → manga bridge (AI answer + community votes)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.manga_bridge (
  anime_key text primary key check (char_length(anime_key) between 1 and 300),
  anime_title text not null default '',
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.manga_bridge enable row level security;
drop policy if exists "manga_bridge read" on public.manga_bridge;
create policy "manga_bridge read" on public.manga_bridge for select to authenticated using (true);

create table if not exists public.manga_bridge_votes (
  anime_key text not null check (char_length(anime_key) between 1 and 300),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  end_chapter numeric(7, 1) not null check (end_chapter > 0 and end_chapter < 10000),
  created_at timestamptz not null default now(),
  primary key (anime_key, user_id)
);
alter table public.manga_bridge_votes enable row level security;
-- No direct policies: votes go through vote_manga_bridge(), reads through
-- get_manga_bridge() (aggregate only).

-- Bridge + vote summary for one anime. votes = [{ch, n}] sorted by n desc.
create or replace function public.get_manga_bridge(p_anime_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'payload', (select b.payload from public.manga_bridge b where b.anime_key = p_anime_key),
    'updated_at', (select b.updated_at from public.manga_bridge b where b.anime_key = p_anime_key),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object('ch', v.ch, 'n', v.n) order by v.n desc, v.ch desc)
      from (
        select end_chapter as ch, count(*)::int as n
        from public.manga_bridge_votes
        where anime_key = p_anime_key
        group by end_chapter
      ) v
    ), '[]'::jsonb),
    'mine', (
      select mv.end_chapter from public.manga_bridge_votes mv
      where mv.anime_key = p_anime_key and mv.user_id = auth.uid()
    )
  );
$$;

create or replace function public.vote_manga_bridge(p_anime_key text, p_end_chapter numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_anime_key is null or char_length(p_anime_key) not between 1 and 300 then
    raise exception 'invalid key';
  end if;
  if p_end_chapter is null or p_end_chapter <= 0 or p_end_chapter >= 10000 then
    raise exception 'invalid chapter';
  end if;
  insert into public.manga_bridge_votes (anime_key, user_id, end_chapter)
  values (p_anime_key, auth.uid(), round(p_end_chapter, 1))
  on conflict (anime_key, user_id)
  do update set end_chapter = excluded.end_chapter, created_at = now();
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Episode reactions (hype map)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.episode_reactions (
  anime_key text not null check (char_length(anime_key) between 1 and 200),
  ep_num integer not null check (ep_num between 0 and 5000),
  -- 5-second bucket index (covers ~3.4 hours, enough for movies).
  bucket integer not null check (bucket between 0 and 2500),
  emoji text not null check (emoji in ('fire', 'laugh', 'cry', 'shock', 'love', 'clap')),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (anime_key, ep_num, bucket, emoji, user_id)
);
create index if not exists episode_reactions_user_time on public.episode_reactions (user_id, created_at desc);
alter table public.episode_reactions enable row level security;
drop policy if exists "reactions own insert" on public.episode_reactions;
drop policy if exists "reactions own delete" on public.episode_reactions;
create policy "reactions own insert" on public.episode_reactions for insert to authenticated with check (auth.uid() = user_id);
create policy "reactions own delete" on public.episode_reactions for delete to authenticated using (auth.uid() = user_id);

-- Anti-spam: at most 30 reactions per user per minute.
create or replace function public.enforce_reaction_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.episode_reactions r
    where r.user_id = new.user_id and r.created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_reaction_rate() from public, anon, authenticated;
drop trigger if exists episode_reactions_rate on public.episode_reactions;
create trigger episode_reactions_rate before insert on public.episode_reactions
  for each row execute function public.enforce_reaction_rate();

create or replace function public.get_episode_reactions(p_anime_key text, p_ep integer)
returns table (bucket integer, emoji text, n integer, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.bucket, r.emoji, count(*)::int as n, bool_or(r.user_id = auth.uid()) as mine
  from public.episode_reactions r
  where r.anime_key = p_anime_key and r.ep_num = p_ep
  group by r.bucket, r.emoji
  order by r.bucket;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Crowdsourced server health (hourly buckets, no per-user rows kept)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.server_health_hourly (
  source text not null,
  provider text not null,
  hour timestamptz not null,
  ok_count integer not null default 0,
  fail_count integer not null default 0,
  start_ms_sum bigint not null default 0,
  start_ms_n integer not null default 0,
  primary key (source, provider, hour)
);
alter table public.server_health_hourly enable row level security;

create table if not exists public.server_health_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null default now(),
  n integer not null default 0
);
alter table public.server_health_limits enable row level security;

create or replace function public.report_server_health(
  p_source text, p_provider text, p_ok boolean, p_start_ms integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
  v_ms integer;
begin
  if v_uid is null then return; end if;
  if p_source is null or p_source !~ '^[a-z0-9_-]{1,32}$' then return; end if;
  if p_provider is null or p_provider !~ '^[a-z0-9_.-]{1,40}$' then return; end if;
  if p_ok is null then return; end if;

  -- 60 reports per user per 10 minutes; extra reports are silently dropped.
  insert into public.server_health_limits as l (user_id, window_start, n)
  values (v_uid, now(), 1)
  on conflict (user_id) do update set
    window_start = case when l.window_start < now() - interval '10 minutes' then now() else l.window_start end,
    n = case when l.window_start < now() - interval '10 minutes' then 1 else l.n + 1 end
  returning n into v_n;
  if v_n > 60 then return; end if;

  v_ms := case when p_ok and p_start_ms between 1 and 120000 then p_start_ms else null end;
  insert into public.server_health_hourly as h (source, provider, hour, ok_count, fail_count, start_ms_sum, start_ms_n)
  values (
    p_source, p_provider, date_trunc('hour', now()),
    case when p_ok then 1 else 0 end,
    case when p_ok then 0 else 1 end,
    coalesce(v_ms, 0),
    case when v_ms is null then 0 else 1 end
  )
  on conflict (source, provider, hour) do update set
    ok_count = h.ok_count + excluded.ok_count,
    fail_count = h.fail_count + excluded.fail_count,
    start_ms_sum = h.start_ms_sum + excluded.start_ms_sum,
    start_ms_n = h.start_ms_n + excluded.start_ms_n;
end;
$$;

create or replace function public.get_server_health()
returns table (
  source text, provider text,
  ok integer, fail integer, avg_ms integer,
  recent_ok integer, recent_fail integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    h.source, h.provider,
    sum(h.ok_count)::int,
    sum(h.fail_count)::int,
    case when sum(h.start_ms_n) > 0 then (sum(h.start_ms_sum) / sum(h.start_ms_n))::int else null end,
    coalesce(sum(h.ok_count) filter (where h.hour >= date_trunc('hour', now()) - interval '2 hours'), 0)::int,
    coalesce(sum(h.fail_count) filter (where h.hour >= date_trunc('hour', now()) - interval '2 hours'), 0)::int
  from public.server_health_hourly h
  where h.hour >= date_trunc('hour', now()) - interval '23 hours'
  group by h.source, h.provider;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Shared moments (timestamped episode links)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.shared_moments (
  id text primary key check (id ~ '^[A-Za-z0-9]{6,12}$'),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  episode_href text not null check (char_length(episode_href) between 8 and 1000 and episode_href ~ '^https://'),
  anime_href text check (anime_href is null or (char_length(anime_href) <= 1000 and anime_href ~ '^https://')),
  anime_title text not null check (char_length(anime_title) between 1 and 200),
  ep_num integer check (ep_num is null or ep_num between 0 and 5000),
  image text check (image is null or (char_length(image) <= 1000 and image ~ '^https://')),
  t_sec integer not null check (t_sec between 0 and 20000),
  note text check (note is null or char_length(note) <= 140),
  sharer_name text check (sharer_name is null or char_length(sharer_name) <= 60),
  url4up text check (url4up is null or (char_length(url4up) <= 1000 and url4up ~ '^https://')),
  url3rb text check (url3rb is null or (char_length(url3rb) <= 1000 and url3rb ~ '^https://')),
  created_at timestamptz not null default now()
);
create index if not exists shared_moments_user_time on public.shared_moments (user_id, created_at desc);
alter table public.shared_moments enable row level security;
drop policy if exists "moments public read" on public.shared_moments;
drop policy if exists "moments own insert" on public.shared_moments;
drop policy if exists "moments own delete" on public.shared_moments;
create policy "moments public read" on public.shared_moments for select to anon, authenticated using (true);
create policy "moments own insert" on public.shared_moments for insert to authenticated with check (auth.uid() = user_id);
create policy "moments own delete" on public.shared_moments for delete to authenticated using (auth.uid() = user_id);

create or replace function public.enforce_moment_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.shared_moments m
    where m.user_id = new.user_id and m.created_at > now() - interval '1 hour'
  ) >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_moment_rate() from public, anon, authenticated;
drop trigger if exists shared_moments_rate on public.shared_moments;
create trigger shared_moments_rate before insert on public.shared_moments
  for each row execute function public.enforce_moment_rate();

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Wrapped share cards (one per user per year, public read)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.wrapped_cards (
  id text primary key check (id ~ '^[A-Za-z0-9]{6,12}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  year integer not null check (year between 2020 and 2100),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 24576),
  updated_at timestamptz not null default now(),
  unique (user_id, year)
);
alter table public.wrapped_cards enable row level security;
drop policy if exists "wrapped public read" on public.wrapped_cards;
create policy "wrapped public read" on public.wrapped_cards for select to anon, authenticated using (true);

-- Create-or-update the caller's card for a year; returns its stable id.
create or replace function public.publish_wrapped(p_year integer, p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id text;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  i integer;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  if p_year is null or p_year < 2020 or p_year > 2100 then raise exception 'invalid year'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) >= 24576 then
    raise exception 'invalid payload';
  end if;

  select w.id into v_id from public.wrapped_cards w where w.user_id = v_uid and w.year = p_year;
  if v_id is not null then
    update public.wrapped_cards set payload = p_payload, updated_at = now() where id = v_id;
    return v_id;
  end if;

  loop
    v_id := '';
    for i in 1..9 loop
      v_id := v_id || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into public.wrapped_cards (id, user_id, year, payload) values (v_id, v_uid, p_year, p_payload);
      return v_id;
    exception when unique_violation then
      -- id collision (or a concurrent publish for the same year): retry/reuse.
      select w.id into v_id from public.wrapped_cards w where w.user_id = v_uid and w.year = p_year;
      if v_id is not null then
        update public.wrapped_cards set payload = p_payload, updated_at = now() where id = v_id;
        return v_id;
      end if;
    end;
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Grants: RPCs callable by signed-in users only.
-- ─────────────────────────────────────────────────────────────────────────
revoke execute on function public.get_manga_bridge(text) from public, anon;
revoke execute on function public.vote_manga_bridge(text, numeric) from public, anon;
revoke execute on function public.get_episode_reactions(text, integer) from public, anon;
revoke execute on function public.report_server_health(text, text, boolean, integer) from public, anon;
revoke execute on function public.get_server_health() from public, anon;
revoke execute on function public.publish_wrapped(integer, jsonb) from public, anon;
grant execute on function public.get_manga_bridge(text) to authenticated;
grant execute on function public.vote_manga_bridge(text, numeric) to authenticated;
grant execute on function public.get_episode_reactions(text, integer) to authenticated;
grant execute on function public.report_server_health(text, text, boolean, integer) to authenticated;
grant execute on function public.get_server_health() to authenticated;
grant execute on function public.publish_wrapped(integer, jsonb) to authenticated;

commit;
