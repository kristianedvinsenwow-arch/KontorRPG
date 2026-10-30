-- Logged-out visitors get nothing; logged-in players may only SELECT (and RLS limits that to their own row).
revoke all on public.characters from anon;
revoke truncate, trigger, references on public.characters from authenticated;
