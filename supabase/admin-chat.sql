-- Pantoufa — admin↔user chat schema (3.2.0)
-- Apply via Supabase dashboard → SQL Editor, or `supabase db push`.
--
-- Admin can open a chat thread with any user, exchange messages, and close it
-- when the issue is resolved. A user can ONLY reply inside a thread the admin
-- has opened with them, and only while the thread is open — there is no other
-- path to send a chat message (so users can never talk to each other).
--
-- Tables:
--   admin_chats          one thread per (admin_id, user_id) pair
--   admin_chat_messages the messages inside that thread
--
-- RPCs (mirror lib/usage.ts admin pattern — caller email must equal ADMIN_EMAILS
-- from lib/presence.ts for the admin_* family):
--   admin_open_chat(p_user_id)        admin starts / reopens a thread → chat row
--   admin_close_chat(p_chat_id)       admin marks the thread closed
--   admin_reopen_chat(p_chat_id)      admin reopens a closed thread
--   admin_list_chats()                admin inbox (last msg + user profile)
--   chat_send_message(p_chat_id,body) admin OR participant sends (open only)
--   chat_fetch_messages(p_chat_id)    admin OR participant reads the thread
--   chat_my_thread()                  a user reads the chat admin opened with them
--
-- Closed-app push: a trigger on admin_chat_messages fires an async HTTPS POST to
-- Expo's push API (pg_net, same pattern as notify_report_telegram) for the
-- recipient's registered Expo push tokens (notifications.sql → push_tokens).

-- The admin email MUST stay in sync with ADMIN_EMAILS in lib/presence.ts.
-- Single-admin list kept as a function so the policy and every admin_* RPC share
-- one source of truth inside the DB.
create or replace function public.admin_chat_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'zlabia66@gmail.com'
$$;

-- ── admin_chats ───────────────────────────────────────────────────────
create table if not exists public.admin_chats (
  id               uuid primary key default gen_random_uuid(),
  admin_id         uuid not null references auth.users(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  status           text not null default 'open' check (status in ('open','closed')),
  created_at       timestamptz not null default now(),
  closed_at        timestamptz,
  last_message_at  timestamptz,
  last_message_body text,
  unique (admin_id, user_id)
);

alter table public.admin_chats enable row level security;

-- Both participants can read their own thread; only admin can write/update.
create policy "admin_chats_read_participants" on public.admin_chats
  for select using (auth.uid() = admin_id or auth.uid() = user_id);
create policy "admin_chats_update_admin" on public.admin_chats
  for update using (public.admin_chat_is_admin());

-- Inserts/writes go through the admin_open_chat RPC (security definer), so no
-- direct insert policy is exposed to clients.

-- ── admin_chat_messages ──────────────────────────────────────────────
create table if not exists public.admin_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.admin_chats(id) on delete cascade,
  sender_id   uuid not null references auth.users(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists admin_chat_messages_chat_idx
  on public.admin_chat_messages (chat_id, created_at desc);

alter table public.admin_chat_messages enable row level security;

-- Only participants of the parent thread can read its messages.
create policy "admin_chat_messages_read_participants" on public.admin_chat_messages
  for select using (
    exists (
      select 1 from public.admin_chats c
      where c.id = admin_chat_messages.chat_id
        and (c.admin_id = auth.uid() or c.user_id = auth.uid())
    )
  );

-- Direct client inserts are blocked — writes go through chat_send_message
-- (security definer), which enforces "open thread + caller is participant".

alter table public.admin_chats REPLICA IDENTITY full;
alter table public.admin_chat_messages REPLICA IDENTITY full;

-- Add to the Realtime publication so the client supabase.channel(...) works on
-- both tables. `alter publication ... add table` is a no-op if the table is
-- already a member, so it's safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'admin_chats'
  ) then
    alter publication supabase_realtime add table public.admin_chats;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'admin_chat_messages'
  ) then
    alter publication supabase_realtime add table public.admin_chat_messages;
  end if;
end$$;

-- ── RPC: admin_open_chat(p_user_id) ──────────────────────────────────
-- Idempotent: if a thread with that user already exists, reopen it (status =
-- 'open', closed_at = null) and reassign admin_id to the current caller (so
-- multiple admins are handled without breaking the uniqueness constraint).
-- Returns the chat row.
create or replace function public.admin_open_chat(p_user_id uuid)
returns public.admin_chats
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  row       public.admin_chats;
begin
  if not public.admin_chat_is_admin() then
    raise exception 'not admin';
  end if;
  if caller_id is null or p_user_id is null then
    raise exception 'missing args';
  end if;

  insert into public.admin_chats (admin_id, user_id, status, closed_at)
    values (caller_id, p_user_id, 'open', null)
    on conflict (admin_id, user_id) do update
      set status = 'open', closed_at = null
    returning * into row;

  -- If the user already had a thread under a different admin earlier, the ON
  -- CONFLICT above didn't touch it. Re-bind it to the current admin so there
  -- is exactly one active thread per admin↔user pair, status 'open'.
  if row is null then
    update public.admin_chats
      set admin_id = caller_id, status = 'open', closed_at = null
      where user_id = p_user_id
      returning * into row;
  end if;

  return row;
end;
$$;

-- ── RPC: admin_close_chat(p_chat_id) ─────────────────────────────────
create or replace function public.admin_close_chat(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.admin_chat_is_admin() then
    raise exception 'not admin';
  end if;
  update public.admin_chats
    set status = 'closed', closed_at = now()
    where id = p_chat_id;
end;
$$;

-- ── RPC: admin_reopen_chat(p_chat_id) ────────────────────────────────
create or replace function public.admin_reopen_chat(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.admin_chat_is_admin() then
    raise exception 'not admin';
  end if;
  update public.admin_chats
    set status = 'open', closed_at = null
    where id = p_chat_id;
end;
$$;

-- ── RPC: admin_list_chats() ──────────────────────────────────────────
-- Admin inbox — every chat with the user's profile (email/name/avatar), last
-- message preview, status, and an unread_since marker (timestamp of the
-- newest message NOT sent by the admin, defaults to created_at if no one has
-- replied yet — used by the client to show an unread dot).
create or replace function public.admin_list_chats()
returns table (
  id               uuid,
  user_id          uuid,
  admin_id         uuid,
  status           text,
  created_at       timestamptz,
  closed_at        timestamptz,
  last_message_at  timestamptz,
  last_message_body text,
  user_email       text,
  user_name        text,
  user_avatar      text
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.admin_chat_is_admin() then
    return;
  end if;
  return query
    select
      c.id, c.user_id, c.admin_id, c.status, c.created_at, c.closed_at,
      c.last_message_at, c.last_message_body,
      u.email::text                                          as user_email,
      coalesce(u.raw_user_meta_data ->> 'full_name',
               u.raw_user_meta_data ->> 'name',
               split_part(coalesce(u.email, ''), '@', 1))::text as user_name,
      coalesce(u.raw_user_meta_data ->> 'avatar_url',
               u.raw_user_meta_data ->> 'picture')::text       as user_avatar
    from public.admin_chats c
    join auth.users u on u.id = c.user_id
    order by coalesce(c.last_message_at, c.created_at) desc;
end;
$$;

-- ── RPC: chat_send_message(p_chat_id, p_body) ────────────────────────
-- Works for both admin and user senders. Requires: caller is a participant
-- of that thread AND the thread status = 'open'. Side-effects:
--   • inserts the message row
--   • bumps the parent's last_message_at / last_message_body
--   • (the trigger below fans out the closed-app push to the recipient)
-- Returns the inserted message row.
create or replace function public.chat_send_message(
  p_chat_id uuid,
  p_body    text
)
returns public.admin_chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  thread    public.admin_chats;
  msg       public.admin_chat_messages;
begin
  if caller_id is null or p_chat_id is null then
    raise exception 'missing args';
  end if;
  if p_body is null or trim(p_body) = '' then
    raise exception 'empty body';
  end if;

  select * into thread from public.admin_chats where id = p_chat_id;
  if thread is null then
    raise exception 'no such chat';
  end if;
  if thread.status <> 'open' then
    raise exception 'chat closed';
  end if;
  if caller_id <> thread.admin_id and caller_id <> thread.user_id then
    raise exception 'not a participant';
  end if;

  insert into public.admin_chat_messages (chat_id, sender_id, body)
    values (p_chat_id, caller_id, p_body)
    returning * into msg;

  update public.admin_chats
    set last_message_at = msg.created_at,
        last_message_body = msg.body
    where id = p_chat_id;

  return msg;
end;
$$;

-- ── RPC: chat_fetch_messages(p_chat_id) ─────────────────────────────
create or replace function public.chat_fetch_messages(p_chat_id uuid)
returns setof public.admin_chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null or p_chat_id is null then return; end if;
  if not exists (
    select 1 from public.admin_chats
    where id = p_chat_id
      and (admin_id = caller_id or user_id = caller_id)
  ) then
    return;
  end if;
  return query
    select * from public.admin_chat_messages
    where chat_id = p_chat_id
    order by created_at asc;
end;
$$;

-- ── RPC: chat_my_thread() ────────────────────────────────────────────
-- A USER reads the (single) thread admin opened with them. Includes closed
-- threads so they can see history and a "closed by admin" state. Returns the
-- newest open thread, falling back to the newest closed one if none open.
create or replace function public.chat_my_thread()
returns public.admin_chats
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  row       public.admin_chats;
begin
  if caller_id is null then return null; end if;
  select * into row from public.admin_chats
    where user_id = caller_id and status = 'open'
    order by created_at desc limit 1;
  if row is null then
    select * into row from public.admin_chats
      where user_id = caller_id
      order by created_at desc limit 1;
  end if;
  return row;
end;
$$;

-- ── Closed-app push trigger ───────────────────────────────────────────
-- After a message is inserted, fire an async HTTPS POST to Expo's push API for
-- every enabled push token owned by the RECIPIENT (the non-sender participant
-- of the thread). Mirrors notify_report_telegram: pg_net async HTTP, never
-- blocks the insert on a notification failure.
--
-- Title/body:
--   admin → user   : "المشرف"  · message body
--   user  → admin   : "رد من <user name>" · message body
--
-- Tap data carries `{ chatId, chatKind: 'admin' }` so the app can deep-link to
-- the right conversation screen regardless of which side tapped it.
create or replace function public.notify_chat_push()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  thread     public.admin_chats;
  recipient  uuid;
  sender     text;
  title      text;
  is_to_admin boolean;
  body_json  jsonb;
begin
  select * into thread from public.admin_chats where id = new.chat_id;
  if thread is null then return new; end if;

  -- Closed threads don't push (admin closed → conversation ended).
  if thread.status <> 'open' then
    return new;
  end if;

  is_to_admin := new.sender_id = thread.user_id;  -- user wrote → admin receives
  recipient := case when is_to_admin then thread.admin_id else thread.user_id end;

  -- Sender display name for the "user → admin" title.
  if is_to_admin then
    select coalesce(raw_user_meta_data ->> 'full_name',
                    raw_user_meta_data ->> 'name',
                    split_part(coalesce(email, ''), '@', 1))
      into sender
      from auth.users where id = new.sender_id;
    title := coalesce('رد من ' || sender, 'رسالة جديدة');
  else
    title := 'المشرف';
  end if;

  -- Expo accepts an array of {to,...} objects (max 100/request). A user almost
  -- always has ≤ 3 tokens, so a single POST per message is plenty — chunk only
  -- when over the limit (won't happen in practice but keeps us correct).
  with rows as (
    select token,
           row_number() over (order by token) - 1 as rn
    from public.push_tokens
    where user_id = recipient and enabled = true
  ),
  chunks as (
    select rn / 100 as chunk,
           jsonb_agg(jsonb_build_object(
             'to',    token,
             'title', title,
             'body',  new.body,
             'sound', 'default',
             'data',  jsonb_build_object(
               'chatId',  thread.id::text,
               'chatKind','admin'
             )
           )) as payload
    from rows
    group by rn / 100
  )
  select payload into body_json from chunks limit 1;

  if body_json is not null then
    perform net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Accept',        'application/json'
      ),
      body    := body_json
    );
  end if;

  return new;
exception when others then
  -- Never break a message insert because the push call failed.
  return new;
end;
$$;

drop trigger if exists trg_chat_push on public.admin_chat_messages;
create trigger trg_chat_push
  after insert on public.admin_chat_messages
  for each row execute function public.notify_chat_push();

-- ── Closed-app push for thread creation ──────────────────────────────
-- Fires when admin opens a NEW thread, so the user is notified even before
-- the admin has sent any message. `last_message_body` is null at INSERT, so
-- we use a fixed "افتح المحادثة للرد" body; the user receives a second push
-- when the admin sends the first actual message (from trg_chat_push).
-- Skip UPDATEs (re-open of a closed thread reuses the same row → no need to
-- notify the user again).
create or replace function public.notify_chat_opened_push()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  body_json jsonb;
begin
  if new.user_id = auth.uid() then
    return new; -- the user themselves somehow opened their own (not possible via API, but safe)
  end if;

  with rows as (
    select token
    from public.push_tokens
    where user_id = new.user_id and enabled = true
  )
  select jsonb_agg(jsonb_build_object(
    'to',    token,
    'title', 'المشرف',
    'body',  'بدأ المشرف محادثة جديدة معك',
    'sound', 'default',
    'data',  jsonb_build_object(
      'chatId',   new.id::text,
      'chatKind', 'admin'
    )
  )) into body_json from rows;

  if body_json is not null then
    perform net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Accept',        'application/json'
      ),
      body    := body_json
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_chat_opened on public.admin_chats;
create trigger trg_chat_opened
  after insert on public.admin_chats
  for each row execute function public.notify_chat_opened_push();

-- Revoke default PUBLIC execute on all RPCs so only authenticated callers can
-- reach them through RLS / the security definer gate. (Functions are SECURITY
-- DEFINER, so the auth.uid() / admin email check inside is the real gate; this
-- revocation just keeps anon from poking them.)
revoke execute on function public.admin_open_chat(uuid)        from public;
revoke execute on function public.admin_close_chat(uuid)       from public;
revoke execute on function public.admin_reopen_chat(uuid)      from public;
revoke execute on function public.admin_list_chats()           from public;
revoke execute on function public.chat_send_message(uuid, text) from public;
revoke execute on function public.chat_fetch_messages(uuid)    from public;
revoke execute on function public.chat_my_thread()             from public;
revoke execute on function public.notify_chat_push()          from public;
revoke execute on function public.notify_chat_opened_push()   from public;
revoke execute on function public.admin_chat_is_admin()       from public;