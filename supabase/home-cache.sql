-- Crowdsourced home-feed cache — a single shared row holding the latest home
-- payload (featured + sections) uploaded by a "scout" device that successfully
-- scraped a source. Devices that can't reach ANY source domain (ISP-level
-- block that DoH can't beat) download this instead of showing an empty home.
-- See lib/homeCloudCache.ts.
--
-- Reads: any authenticated user SELECTs the row (public anime metadata only).
-- Writes: ONLY via the submit_home_feed RPC (SECURITY DEFINER) — no direct
--   INSERT/UPDATE policies exist. The RPC validates the payload shape, pins
--   every item href to the known source hosts, and rate-limits each user.

create table if not exists public.home_feed_cache (
  id         text primary key,              -- always 'home' (singleton row)
  payload    jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.home_feed_cache enable row level security;

-- Public metadata → every signed-in user may read the shared row.
create policy "home_feed_cache_select_all"
  on public.home_feed_cache for select
  to authenticated
  using (true);

-- Per-user write timestamps backing the RPC's cooldown. No policies at all:
-- only the SECURITY DEFINER function touches this table.
create table if not exists public.home_feed_writes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_at timestamptz not null default now()
);

alter table public.home_feed_writes enable row level security;

-- Scout upload. Validates structure, then upserts the singleton row.
-- Silent no-op (not an error) when the caller is inside the cooldown window —
-- another scout's upload covers the gap.
create or replace function public.submit_home_feed(p_payload jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_last timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Shape: { success, data: { featured: [], sections: [ { items: [...] } ] } }
  -- with at least one section, and a sane size (a real feed is well under
  -- 1 MB even with the duplicated TV/movie rails).
  if p_payload is null
     or jsonb_typeof(p_payload -> 'data') is distinct from 'object'
     or jsonb_typeof(p_payload -> 'data' -> 'sections') is distinct from 'array'
     or jsonb_array_length(coalesce(p_payload -> 'data' -> 'sections', '[]'::jsonb)) = 0
     or pg_column_size(p_payload) > 1048576 then
    raise exception 'invalid home payload';
  end if;

  -- Every non-empty item href must be an https URL on a known source host —
  -- keeps a malicious client from seeding cards that link anywhere else.
  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'data' -> 'sections') as s,
         jsonb_array_elements(s -> 'items') as i
    where coalesce(i ->> 'href', '') <> ''
      and i ->> 'href' !~ '^https://([a-z0-9-]+\.)*(witanime\.[a-z]+|anime4up\.[a-z]+|anime3rb\.com)(/|$)'
  ) or exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload -> 'data' -> 'featured', '[]'::jsonb)) as f
    where coalesce(f ->> 'href', '') <> ''
      and f ->> 'href' !~ '^https://([a-z0-9-]+\.)*(witanime\.[a-z]+|anime4up\.[a-z]+|anime3rb\.com)(/|$)'
  ) then
    raise exception 'invalid href host';
  end if;

  -- Per-user cooldown: 10 minutes between uploads.
  select last_at into v_last from public.home_feed_writes where user_id = v_uid;
  if v_last is not null and v_last > now() - interval '10 minutes' then
    return;
  end if;
  insert into public.home_feed_writes (user_id, last_at) values (v_uid, now())
  on conflict (user_id) do update set last_at = now();

  insert into public.home_feed_cache (id, payload, updated_by, updated_at)
  values ('home', p_payload, v_uid, now())
  on conflict (id) do update
    set payload = excluded.payload,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;

revoke all on function public.submit_home_feed(jsonb) from public;
grant execute on function public.submit_home_feed(jsonb) to authenticated;
