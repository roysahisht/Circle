-- Usage tracking. Paste into Supabase -> SQL Editor -> Run. Safe to run once.
--
-- activity_days: one row per person per day they opened the app (IST). The app adds a row
-- when someone signed-in opens it. Nobody can read this table through the app or the API —
-- only you, in the Supabase SQL Editor (see supabase/dashboard.sql).

create table public.activity_days (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null default ((now() at time zone 'Asia/Kolkata')::date),
  primary key (user_id, day)
);

alter table public.activity_days enable row level security;

-- You may only record your own visit, and never read anyone's.
create policy "record own visit" on public.activity_days for insert to authenticated
  with check (user_id = auth.uid());

grant insert on public.activity_days to authenticated;
