-- ── Telegram alerts for new issue reports ────────────────────────────
-- When a row is inserted into public.reports, fire a Telegram message to the
-- maintainer chat via pg_net (async HTTP). Backend-free: no edge function.
--
-- Secrets live in Supabase Vault (not hardcoded here / not in pg_proc):
--   telegram_bot_token  -- from @BotFather, e.g. 123456789:AAE...
--   telegram_chat_id    -- DM or group id, e.g. 12345678 or -1001234567890
--
-- To (re)set the secrets:
--   select vault.create_secret('<token>', 'telegram_bot_token');
--   select vault.create_secret('<chat_id>', 'telegram_chat_id');
-- (use vault.update_secret(id, ...) to change later)

create or replace function public.notify_report_telegram()
returns trigger
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  bot_token text;
  chat_id   text;
  msg       text;
  shot      text;
begin
  select decrypted_secret into bot_token
    from vault.decrypted_secrets where name = 'telegram_bot_token' limit 1;
  select decrypted_secret into chat_id
    from vault.decrypted_secrets where name = 'telegram_chat_id' limit 1;

  -- Misconfigured? Don't block the insert.
  if bot_token is null or chat_id is null then
    return new;
  end if;

  -- Build a human-readable, HTML-formatted message.
  msg :=
    '🐛 <b>New report</b>' ||
    case when new.category is not null then ' · ' || new.category else '' end ||
    E'\n\n' || coalesce(new.message, '(no message)') ||
    E'\n\n' ||
    '👤 ' || coalesce(new.email, 'anon') || E'\n' ||
    '📦 v' || coalesce(new.app_version, '?') ||
      ' · ' || coalesce(new.platform, '?') ||
      coalesce(' ' || new.os_version, '') || E'\n' ||
    coalesce('📱 ' || new.device || E'\n', '') ||
    coalesce('🖼 <a href="' || new.screenshot_url || '">screenshot</a>' || E'\n', '') ||
    '🕒 ' || to_char(new.created_at, 'YYYY-MM-DD HH24:MI');

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || bot_token || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
                 'chat_id', chat_id,
                 'text', msg,
                 'parse_mode', 'HTML',
                 'disable_web_page_preview', true
               )
  );

  return new;
exception when others then
  -- Never let a notification failure break the report insert.
  return new;
end;
$$;

drop trigger if exists trg_reports_telegram on public.reports;
create trigger trg_reports_telegram
  after insert on public.reports
  for each row execute function public.notify_report_telegram();
