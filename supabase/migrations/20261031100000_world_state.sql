-- Shared world state the game server keeps across restarts: depleted veins and trees, monster
-- respawn timers (bosses especially) and items lying on the ground. Only the server (secret key)
-- reads or writes it; browsers get nothing.
create table if not exists public.world_state (
  key text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.world_state enable row level security;
revoke all on public.world_state from anon, authenticated;
