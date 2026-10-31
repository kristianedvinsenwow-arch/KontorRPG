-- Achievement counters, finished achievements and the chosen title (written only by the game server).
alter table public.characters add column if not exists achievements jsonb not null default '{}'::jsonb;
