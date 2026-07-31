-- Remote device logs — users' devices write failure traces here, the admin
-- reads them to diagnose "stuck on loading" / scrape-fail issues remotely.
--
-- Writes: any authenticated user INSERTs their own rows (RLS: uid = user_id).
-- Reads: ONLY the admin sees all rows (via admin_list_logs RPC, gated by the
--   same SECURITY DEFINER email allowlist used by admin-chat.sql). No direct
--   SELECT policy exists, so a user can NEVER read anyone's logs (including
--   their own) — this is write-only telemetry, per the user's request.
-- Retention: pg_cron auto-deletes rows older than 30 days (if pg_cron is on).

create table if not exists public.device_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  email       text,
  level       text not null default 'info',   -- 'info' | 'warn' | 'error'
  tag         text not null default 'app',    -- 'auth' | 'home' | 'scraper' | 'video' | 'app'
  message     text not null,
  context     jsonb,                           -- arbitrary structured details
  app_version text,
  platform    text,
  device      text,
  os_version  text,
  created_at  timestamptz not null default now()
);

alter table public.device_logs enable row level security;

-- Users can only INSERT their own rows. No SELECT policy → write-only.
create policy "device_logs_insert_own"
  on public.device_logs for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Admin reads via RPC (SECURITY DEFINER bypasses RLS), no direct SELECT policy.

-- Mirrors admin_chat_is_admin() in admin-chat.sql — same email allowlist.
create or replace function public.device_logs_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'zlabia66@gmail.com'
$$;

-- Returns recent logs, newest first, limited. Optional level filter.
create or replace function public.admin_list_logs(
  p_limit int default 200,
  p_level text default null,
  p_offset int default 0
)
returns table (
  id          uuid,
  user_id     uuid,
  email       text,
  level       text,
  tag         text,
  message     text,
  context     jsonb,
  app_version text,
  platform    text,
  device      text,
  os_version  text,
  created_at  timestamptz
)
language sql security definer set search_path = public as $$
  select * from public.device_logs
  where (p_level is null or level = p_level)
  order by created_at desc
  limit p_limit offset p_offset;
$$;

revoke execute on function public.admin_list_logs from public;
grant execute on function public.admin_list_logs to authenticated;

-- Auto-cleanup: delete logs older than 30 days. Runs hourly if pg_cron is on.
-- Safe to run multiple times (idempotent — drops the job first).
do $$
begin
  if (select exists from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('device_logs_cleanup');
    perform cron.schedule('device_logs_cleanup', '0 * * * *',
      'delete from public.device_logs where created_at < now() - interval ''30 days''');
  end if;
exception when others then null;
end $$;