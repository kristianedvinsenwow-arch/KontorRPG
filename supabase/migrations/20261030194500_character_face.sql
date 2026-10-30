-- Face chosen in the character creator (index into FACES, 0–4).
alter table public.characters
  add column if not exists face smallint not null default 0 check (face between 0 and 4);
