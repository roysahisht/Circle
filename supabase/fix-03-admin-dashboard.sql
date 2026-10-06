-- Admin dashboard setup. Paste into Supabase -> SQL Editor -> Run. Safe to run more than once.
--
-- Adds:
--   activity_days   a private log of which days each signed-in person opened the app
--   admin_emails    the Google email(s) allowed to open /admin.html (nobody can read it via the API)
--   is_admin()      true only for a signed-in Google account whose email is in admin_emails
--   admin_stats()   all the dashboard numbers in one call; refuses anyone who isn't an admin

-- ---------- who opened the app, per day (private: write-only for users) ----------
create table if not exists public.activity_days (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null default ((now() at time zone 'Asia/Kolkata')::date),
  primary key (user_id, day)
);
alter table public.activity_days enable row level security;
drop policy if exists "record own visit" on public.activity_days;
create policy "record own visit" on public.activity_days for insert to authenticated
  with check (user_id = auth.uid());
grant insert on public.activity_days to authenticated;

-- ---------- admins ----------
create table if not exists public.admin_emails (
  email text primary key
);
alter table public.admin_emails enable row level security; -- no policies: unreadable through the API

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_emails a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- the dashboard numbers ----------
create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'today', v_today,

    'totals', jsonb_build_object(
      'people',       (select count(*) from auth.users),
      'google',       (select count(*) from auth.users where not is_anonymous),
      'name_only',    (select count(*) from auth.users where is_anonymous),
      'ratings',      (select count(*) from public.reviews),
      'raters',       (select count(distinct user_id) from public.reviews),
      'with_photo',   (select count(*) from public.reviews where photo_url is not null),
      'friend_links', (select count(*) / 2 from public.follows),
      'want_items',   (select count(*) from public.want_to_try),
      'user_places',  (select count(*) from public.places where source = 'user')
    ),

    'active', jsonb_build_object(
      'today', (select count(distinct user_id) from public.activity_days where day = v_today),
      'd7',    (select count(distinct user_id) from public.activity_days where day > v_today - 7),
      'd30',   (select count(distinct user_id) from public.activity_days where day > v_today - 30)
    ),

    -- of everyone who joined 7+ days ago, how many opened the app again on a later day
    'retention', jsonb_build_object(
      'eligible', (select count(*) from auth.users u
                   where (u.created_at at time zone 'Asia/Kolkata')::date <= v_today - 7),
      'returned', (select count(*) from auth.users u
                   where (u.created_at at time zone 'Asia/Kolkata')::date <= v_today - 7
                     and exists (select 1 from public.activity_days a
                                 where a.user_id = u.id
                                   and a.day > (u.created_at at time zone 'Asia/Kolkata')::date))
    ),

    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'day', d.day,
          'joined',  (select count(*) from auth.users x where (x.created_at at time zone 'Asia/Kolkata')::date = d.day),
          'ratings', (select count(*) from public.reviews x where (x.created_at at time zone 'Asia/Kolkata')::date = d.day),
          'opened',  (select count(*) from public.activity_days x where x.day = d.day)
        ) order by d.day), '[]'::jsonb)
      from (select generate_series(v_today - 29, v_today, interval '1 day')::date as day) d
    ),

    'people', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.joined_at desc), '[]'::jsonb)
      from (
        select p.display_name as name,
               u.email,
               not u.is_anonymous as google,
               u.created_at as joined_at,
               (select count(*) from public.reviews r where r.user_id = p.id) as ratings,
               (select count(*) from public.follows f where f.follower_id = p.id) as friends,
               (select max(a.day) from public.activity_days a where a.user_id = p.id) as last_opened
        from public.profiles p
        join auth.users u on u.id = p.id
        order by u.created_at desc
        limit 200
      ) t
    ),

    'top_places', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
      from (
        select pl.name, pl.area, count(*) as ratings, round(avg(r.score), 1) as avg_score
        from public.reviews r join public.places pl on pl.id = r.place_id
        group by pl.name, pl.area
        order by count(*) desc, avg(r.score) desc
        limit 10
      ) t
    ),

    'recent', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
      from (
        select p.display_name as name, pl.name as place, r.score, r.bucket, r.note, r.created_at
        from public.reviews r
        join public.profiles p on p.id = r.user_id
        join public.places pl on pl.id = r.place_id
        order by r.created_at desc
        limit 10
      ) t
    )
  );
end;
$$;

-- Only signed-in people can even call these; admin_stats then checks the email itself.
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.admin_stats() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_stats() to authenticated;
