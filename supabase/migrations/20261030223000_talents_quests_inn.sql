-- Talents, quest progress, inn room lease and room storage (written only by the game server).
alter table public.characters
  add column if not exists talents jsonb not null default '{}'::jsonb,
  add column if not exists respecs integer not null default 0,
  add column if not exists quests jsonb not null default '{}'::jsonb,
  add column if not exists lease jsonb,
  add column if not exists storage jsonb not null default '[]'::jsonb;
-- The race list grew (ogres).
alter table public.characters drop constraint if exists characters_race_check;
alter table public.characters add constraint characters_race_check check (race in ('human', 'dwarf', 'gnome', 'ogre'));
