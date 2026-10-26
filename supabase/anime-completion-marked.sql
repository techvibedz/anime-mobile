-- User-set "I finished this anime" mark (detail page toggle). Kept apart from
-- caught_up/finished, which are recomputed from watch history; while this is
-- true the app treats the anime as finished and hides it from Continue Watching.
alter table public.anime_completion
  add column if not exists marked_completed boolean not null default false;

-- Poster for the My List "completed" shelf — a marked anime may never have
-- been watched in the app, so history has no poster for it.
alter table public.anime_completion
  add column if not exists image text;
