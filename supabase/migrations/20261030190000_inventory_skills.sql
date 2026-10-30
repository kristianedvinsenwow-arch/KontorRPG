-- M1: bag, worn equipment and skill XP live on the character row.
-- Still written only by the game server (secret key); players can read their own row.
alter table public.characters
  add column if not exists inventory jsonb not null default '[]'::jsonb,
  add column if not exists equipment jsonb not null default '{}'::jsonb,
  add column if not exists skills jsonb not null default '{}'::jsonb;

-- New characters start with 15 gold (enough for a stone pickaxe at the trading post).
alter table public.characters alter column gold set default 15;
