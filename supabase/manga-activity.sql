-- Pantoufa manga activity: each device mirrors its manga library + reading
-- progress here so the admin "users" screen can show what everyone reads.
-- Users only ever touch their own rows; the admin reads through the two
-- security-definer functions below. The admin email must stay in sync with
-- ADMIN_EMAILS in lib/presence.ts.

begin;

create table if not exists public.manga_activity (
  user_id uuid not null references auth.users (id) on delete cascade,
  manga_key text not null,
  source text not null,
  manga_id text not null,
  title text not null default '',
  cover text,
  chapter_number text,
  page integer not null default 0,
  total integer not null default 0,
  in_library boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, manga_key)
);

alter table public.manga_activity enable row level security;

drop policy if exists "manga_activity own select" on public.manga_activity;
drop policy if exists "manga_activity own insert" on public.manga_activity;
drop policy if exists "manga_activity own update" on public.manga_activity;
drop policy if exists "manga_activity own delete" on public.manga_activity;
create policy "manga_activity own select" on public.manga_activity for select to authenticated using (auth.uid() = user_id);
create policy "manga_activity own insert" on public.manga_activity for insert to authenticated with check (auth.uid() = user_id);
create policy "manga_activity own update" on public.manga_activity for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "manga_activity own delete" on public.manga_activity for delete to authenticated using (auth.uid() = user_id);

create or replace function public.admin_manga_summary()
returns table (
  user_id uuid,
  manga_count bigint,
  reading_count bigint,
  last_read_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'zlabia66@gmail.com' then
    raise exception 'admin only';
  end if;

  return query
  select
    m.user_id,
    count(*)::bigint,
    count(*) filter (where m.chapter_number is not null)::bigint,
    max(m.updated_at)
  from public.manga_activity m
  group by m.user_id;
end;
$$;

create or replace function public.admin_user_manga(p_user_id uuid)
returns table (
  manga_key text,
  source text,
  manga_id text,
  title text,
  cover text,
  chapter_number text,
  page integer,
  total integer,
  in_library boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'zlabia66@gmail.com' then
    raise exception 'admin only';
  end if;

  return query
  select m.manga_key, m.source, m.manga_id, m.title, m.cover, m.chapter_number,
         m.page, m.total, m.in_library, m.updated_at
  from public.manga_activity m
  where m.user_id = p_user_id
  order by m.updated_at desc;
end;
$$;

revoke execute on function public.admin_manga_summary() from public, anon;
revoke execute on function public.admin_user_manga(uuid) from public, anon;
grant execute on function public.admin_manga_summary() to authenticated;
grant execute on function public.admin_user_manga(uuid) to authenticated;

commit;
