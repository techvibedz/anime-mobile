-- Profile edits survive Google sign-in.
--
-- Supabase rewrites full_name / name / avatar_url / picture in
-- raw_user_meta_data from the Google identity on EVERY sign-in, so a user's
-- edited name/photo reverted after sign-out → sign-in, and the admin users
-- list showed the Google values. The app now saves edits under custom_name /
-- custom_avatar_url (keys no provider sends); these readers prefer them.

-- Backfill: users who uploaded an avatar get it back as custom_avatar_url
-- (latest upload). Users whose metadata still holds their edit (avatar_url is
-- still an uploaded file — they haven't signed in again since) also keep
-- their current name as custom_name before the next sign-in can wipe it.
update auth.users u
set raw_user_meta_data = u.raw_user_meta_data
  || jsonb_build_object(
       'custom_avatar_url',
       'https://iwrphgttbjqifstqttqm.supabase.co/storage/v1/object/public/avatars/' || o.name)
  || case when u.raw_user_meta_data->>'avatar_url' like '%/storage/v1/object/public/avatars/%'
            and coalesce(u.raw_user_meta_data->>'full_name', '') <> ''
          then jsonb_build_object('custom_name', u.raw_user_meta_data->>'full_name')
          else '{}'::jsonb end
from (
  select distinct on (split_part(name, '/', 1)) split_part(name, '/', 1) as uid, name
  from storage.objects
  where bucket_id = 'avatars'
  order by split_part(name, '/', 1), created_at desc
) o
where o.uid = u.id::text
  and coalesce(u.raw_user_meta_data->>'custom_avatar_url', '') = '';

create or replace function public.admin_list_users()
 returns table(user_id uuid, email text, name text, avatar_url text, total_seconds bigint, sessions integer, first_seen_at timestamp with time zone, last_seen_at timestamp with time zone, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, version text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if coalesce((auth.jwt() ->> 'email'), '') <> 'zlabia66@gmail.com' then
    raise exception 'not authorized';
  end if;

  return query
  select
    u.id,
    u.email::text,
    coalesce(
      nullif(u.raw_user_meta_data->>'custom_name', ''),
      s.name,
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      split_part(u.email::text, '@', 1)
    ),
    coalesce(
      nullif(u.raw_user_meta_data->>'custom_avatar_url', ''),
      s.avatar_url,
      u.raw_user_meta_data->>'avatar_url',
      u.raw_user_meta_data->>'picture'
    ),
    coalesce(s.total_seconds, 0)::bigint,
    coalesce(s.sessions, 0)::integer,
    s.first_seen_at,
    coalesce(s.last_seen_at, u.last_sign_in_at, u.created_at),
    u.created_at,
    u.last_sign_in_at,
    s.version
  from auth.users u
  left join public.usage_stats s on s.user_id = u.id
  order by coalesce(s.last_seen_at, u.last_sign_in_at, u.created_at) desc nulls last;
end;
$function$;

create or replace function public.admin_list_chats()
 returns table(id uuid, user_id uuid, admin_id uuid, status text, created_at timestamp with time zone, closed_at timestamp with time zone, last_message_at timestamp with time zone, last_message_body text, user_email text, user_name text, user_avatar text)
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
begin
  if not public.admin_chat_is_admin() then
    return;
  end if;
  return query
    select
      c.id, c.user_id, c.admin_id, c.status, c.created_at, c.closed_at,
      c.last_message_at, c.last_message_body,
      u.email::text                                          as user_email,
      coalesce(nullif(u.raw_user_meta_data ->> 'custom_name', ''),
               u.raw_user_meta_data ->> 'full_name',
               u.raw_user_meta_data ->> 'name',
               split_part(coalesce(u.email, ''), '@', 1))::text as user_name,
      coalesce(nullif(u.raw_user_meta_data ->> 'custom_avatar_url', ''),
               u.raw_user_meta_data ->> 'avatar_url',
               u.raw_user_meta_data ->> 'picture')::text       as user_avatar
    from public.admin_chats c
    join auth.users u on u.id = c.user_id
    order by coalesce(c.last_message_at, c.created_at) desc;
end;
$function$;
