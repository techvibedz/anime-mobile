-- Pantoufa admin-only watch history analytics.
-- The admin email must stay in sync with ADMIN_EMAILS in lib/presence.ts.

begin;

create or replace function public.admin_watch_summary()
returns table (
  user_id uuid,
  episodes_started bigint,
  episodes_completed bigint
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
    h.user_id,
    count(*)::bigint,
    count(*) filter (where h.completed)::bigint
  from public.watch_history h
  group by h.user_id;
end;
$$;

drop function if exists public.admin_user_watch_history(uuid);

create function public.admin_user_watch_history(p_user_id uuid)
returns table (
  episode_href text,
  episode_title text,
  anime_title text,
  anime_href text,
  image text,
  image_fallback text,
  position_ms bigint,
  duration_ms bigint,
  completed boolean,
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
  select
    h.episode_href,
    h.episode_title,
    h.anime_title,
    h.anime_href,
    h.image,
    (
      select candidate.image
      from public.watch_history candidate
      where lower(btrim(candidate.anime_title)) = lower(btrim(h.anime_title))
        and nullif(btrim(candidate.image), '') is not null
      order by (candidate.user_id = h.user_id) desc, candidate.updated_at desc
      limit 1
    ) as image_fallback,
    h.position_ms,
    h.duration_ms,
    h.completed,
    h.updated_at
  from public.watch_history h
  where h.user_id = p_user_id
  order by h.updated_at desc;
end;
$$;

revoke execute on function public.admin_watch_summary() from public, anon;
revoke execute on function public.admin_user_watch_history(uuid) from public, anon;
grant execute on function public.admin_watch_summary() to authenticated;
grant execute on function public.admin_user_watch_history(uuid) to authenticated;

commit;
