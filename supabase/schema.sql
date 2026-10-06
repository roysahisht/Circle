-- Circle database setup.
-- Paste this whole file into Supabase -> SQL Editor -> New query -> Run. Run it once.
--
-- What it creates:
--   profiles     one row per user (name shown on their ratings)
--   places       restaurants someone rated, saved or added (the full city list stays in
--                data/bangalore-places.json in the app)
--   reviews      the ratings
--   want_to_try  each person's saved list (private)
--   follows      who is in whose circle
--   invites      invite links ("join my circle")
--   storage bucket "review-photos" for photos people upload
-- Row Level Security makes sure people can only change their own stuff.

-- ---------- tables ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Foodie' check (char_length(display_name) between 1 and 40),
  avatar_url text,
  color text not null default '#FFE66D',
  created_at timestamptz not null default now()
);

create table public.places (
  id text primary key,
  name text not null check (char_length(name) between 1 and 120),
  area text not null default 'Bangalore',
  cuisine text not null default 'Restaurant',
  veg boolean not null default false,
  lat double precision not null check (lat between 12.4 and 13.6),
  lng double precision not null check (lng between 77.1 and 78.1),
  address text not null default '',
  phone text not null default '',
  website text not null default '',
  google_place_id text,
  source text not null default 'user' check (source in ('overture', 'user')),
  added_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  place_id text not null references public.places (id) on delete cascade,
  bucket text not null check (bucket in ('loved', 'fine', 'nope')),
  score numeric(3, 1) not null check (score between 0 and 10),
  dish text check (char_length(dish) <= 60),
  note text check (char_length(note) <= 280),
  photo_url text,
  created_at timestamptz not null default now()
);
create index reviews_place_idx on public.reviews (place_id);
create index reviews_user_idx on public.reviews (user_id);
create index reviews_created_idx on public.reviews (created_at desc);

create table public.want_to_try (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  place_id text not null references public.places (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create table public.follows (
  follower_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id);

create table public.invites (
  token uuid primary key default gen_random_uuid(),
  inviter_id uuid not null default auth.uid() unique references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- who can do what ----------
alter table public.profiles enable row level security;
alter table public.places enable row level security;
alter table public.reviews enable row level security;
alter table public.want_to_try enable row level security;
alter table public.follows enable row level security;
alter table public.invites enable row level security;

-- Everyone can read names, places and ratings (Trending needs them); only you edit yours.
create policy "profiles are public" on public.profiles for select using (true);
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "places are public" on public.places for select using (true);
create policy "signed-in users add places" on public.places for insert to authenticated
  with check (added_by = auth.uid());

create policy "reviews are public" on public.reviews for select using (true);
create policy "post own reviews" on public.reviews for insert to authenticated
  with check (user_id = auth.uid());
create policy "edit own reviews" on public.reviews for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own reviews" on public.reviews for delete to authenticated
  using (user_id = auth.uid());

-- Want to Try is private: only you can see or change yours.
create policy "own want list" on public.want_to_try for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "follows are visible to members" on public.follows for select to authenticated using (true);
create policy "follow as yourself" on public.follows for insert to authenticated
  with check (follower_id = auth.uid());
create policy "unfollow as yourself" on public.follows for delete to authenticated
  using (follower_id = auth.uid());

create policy "see own invite" on public.invites for select to authenticated using (inviter_id = auth.uid());
create policy "create own invite" on public.invites for insert to authenticated
  with check (inviter_id = auth.uid());

grant select on public.profiles, public.places, public.reviews to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.places, public.reviews,
  public.want_to_try, public.follows, public.invites to authenticated;

-- ---------- automatic profile for every new user ----------
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
                  nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
                  'Foodie'), 40),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- invite links: opening a friend's link puts you in each other's circle ----------
create function public.accept_invite(invite_token uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  inviter uuid;
  inviter_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  select i.inviter_id, p.display_name into inviter, inviter_name
  from public.invites i join public.profiles p on p.id = i.inviter_id
  where i.token = invite_token;
  if inviter is null or inviter = auth.uid() then
    return null;
  end if;
  insert into public.follows (follower_id, followee_id)
  values (auth.uid(), inviter), (inviter, auth.uid())
  on conflict do nothing;
  return inviter_name;
end;
$$;

revoke execute on function public.accept_invite(uuid) from public, anon;
grant execute on function public.accept_invite(uuid) to authenticated;

-- ---------- photo storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']);

-- Photos are public to view (via their public URL); you can only upload into / delete from
-- your own folder. Storage needs the "read own" rule too, or deleting silently does nothing.
create policy "read own review photos" on storage.objects for select to authenticated
  using (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "upload own review photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own review photos" on storage.objects for delete to authenticated
  using (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);
