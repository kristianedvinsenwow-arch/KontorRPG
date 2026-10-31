-- Username + PIN accounts instead of Supabase Auth email links. Only the game server (secret key)
-- reads or writes accounts; the PIN is stored as a salted scrypt hash. No email, no recovery.
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null check (char_length(username) between 3 and 16),
  username_lower text not null unique,
  pin_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.accounts enable row level security;
revoke all on public.accounts from anon, authenticated;

-- Characters now belong to accounts. (No characters existed under the old email accounts.)
alter table public.characters drop constraint if exists characters_user_id_fkey;
alter table public.characters add constraint characters_user_id_fkey foreign key (user_id) references public.accounts(id) on delete cascade;
-- Browsers no longer read the database directly; the server sends you your character at login.
drop policy if exists "Players can read their own character" on public.characters;
revoke all on public.characters from anon, authenticated;
