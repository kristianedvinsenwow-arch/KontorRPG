-- One character per account for now (design doc §13: Character).
-- Players may READ their own row (the client shows "Continue as …"); only the game server,
-- using the secret (service-role) key, may create or change rows. That keeps gold, items and
-- position server-authoritative even though the database is reachable from browsers.
create table public.characters (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 16),
  color       smallint not null check (color between 0 and 7),
  race        text not null check (race in ('human', 'dwarf', 'gnome')),
  attrs       jsonb not null,
  major_perk  text not null,
  minor_perk  text not null,
  region      text not null default 'mofjellet',
  pos_x       real,
  pos_y       real,
  pos_z       real,
  yaw         real not null default 0,
  gold        integer not null default 0 check (gold >= 0),
  scales      integer not null default 0 check (scales >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_seen   timestamptz
);

comment on table public.characters is 'KontorRPG characters. Written only by the game server (service role); players can read their own row.';

alter table public.characters enable row level security;

create policy "Players can read their own character"
  on public.characters for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.characters from anon, authenticated;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger characters_touch before update on public.characters
  for each row execute function public.touch_updated_at();
