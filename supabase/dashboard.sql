-- Circle dashboard. In Supabase -> SQL Editor, paste ONE query at a time (select all, Run).
-- Everything here is read-only. Times are in IST (Asia/Kolkata).


-- ============================================================================
-- QUERY 1 — The headline numbers (run this every morning)
-- ============================================================================
with
  today as (select (now() at time zone 'Asia/Kolkata')::date as d),
  u as (
    select id,
           (created_at at time zone 'Asia/Kolkata')::date as joined,
           is_anonymous
    from auth.users
  ),
  r as (select user_id, (created_at at time zone 'Asia/Kolkata')::date as day from public.reviews)
select * from (
  select 1 as n, 'People joined (total)' as metric, count(*)::text as value from u
  union all select 2, '  … joined today',        count(*)::text from u, today where joined = today.d
  union all select 3, '  … joined last 7 days',  count(*)::text from u, today where joined > today.d - 7
  union all select 4, '  … with Google (permanent)', count(*)::text from u where not is_anonymous
  union all select 5, '  … name only (can lose account)', count(*)::text from u where is_anonymous
  union all select 6, 'Ratings posted (total)',  count(*)::text from r
  union all select 7, '  … today',               count(*)::text from r, today where r.day = today.d
  union all select 8, '  … last 7 days',         count(*)::text from r, today where r.day > today.d - 7
  union all select 9, 'People who posted a rating',
         count(distinct user_id)::text from r
  union all select 10, '  … = % of people who joined',
         coalesce(round(100.0 * (select count(distinct user_id) from r) / nullif((select count(*) from u), 0))::text || '%', '-')
  union all select 11, 'Opened the app today',  count(distinct a.user_id)::text from public.activity_days a, today where a.day = today.d
  union all select 12, 'Opened the app in last 7 days', count(distinct a.user_id)::text from public.activity_days a, today where a.day > today.d - 7
  union all select 13, 'Opened the app in last 30 days', count(distinct a.user_id)::text from public.activity_days a, today where a.day > today.d - 30
  union all select 14, 'Friend links (circle connections)', (select count(*) / 2 from public.follows)::text
  union all select 15, 'Photos uploaded', (select count(*) from storage.objects where bucket_id = 'review-photos')::text
  union all select 16, 'Places users added themselves', (select count(*) from public.places where source = 'user')::text
  union all select 17, 'Places on Want to Try lists', (select count(*) from public.want_to_try)::text
) t order by n;


-- ============================================================================
-- QUERY 2 — Day by day, last 30 days: joined / rated / opened the app
-- ============================================================================
with days as (
  select generate_series((now() at time zone 'Asia/Kolkata')::date - 29, (now() at time zone 'Asia/Kolkata')::date, interval '1 day')::date as day
)
select d.day,
       (select count(*) from auth.users x where (x.created_at at time zone 'Asia/Kolkata')::date = d.day) as joined,
       (select count(*) from public.reviews x where (x.created_at at time zone 'Asia/Kolkata')::date = d.day) as ratings,
       (select count(distinct x.user_id) from public.reviews x where (x.created_at at time zone 'Asia/Kolkata')::date = d.day) as people_rating,
       (select count(*) from public.activity_days x where x.day = d.day) as opened_app
from days d
order by d.day desc;


-- ============================================================================
-- QUERY 3 — Who's who: every person, newest first (name, how they joined, activity)
-- Emails are shown here for your eyes only — don't share this screen.
-- ============================================================================
select p.display_name as name,
       case when u.is_anonymous then 'name only' else 'Google' end as account,
       u.email,
       (u.created_at at time zone 'Asia/Kolkata')::date as joined,
       (select count(*) from public.reviews r where r.user_id = p.id) as ratings,
       (select count(*) from public.follows f where f.follower_id = p.id) as friends,
       (select max(day) from public.activity_days a where a.user_id = p.id) as last_opened
from public.profiles p
join auth.users u on u.id = p.id
order by u.created_at desc;


-- ============================================================================
-- QUERY 4 — Do people come back? (of everyone who joined 7+ days ago, % who opened the app again)
-- ============================================================================
select count(*) as joined_7_plus_days_ago,
       count(*) filter (where exists (
         select 1 from public.activity_days a
         where a.user_id = u.id and a.day >= (u.created_at at time zone 'Asia/Kolkata')::date + 1
       )) as came_back_later,
       round(100.0 * count(*) filter (where exists (
         select 1 from public.activity_days a
         where a.user_id = u.id and a.day >= (u.created_at at time zone 'Asia/Kolkata')::date + 1
       )) / nullif(count(*), 0)) as pct_came_back
from auth.users u
where u.created_at < now() - interval '7 days';


-- ============================================================================
-- QUERY 5 — What people are rating: most-rated places and areas
-- ============================================================================
select pl.name, pl.area, pl.cuisine, count(*) as ratings, round(avg(r.score), 1) as avg_score
from public.reviews r join public.places pl on pl.id = r.place_id
group by pl.name, pl.area, pl.cuisine
order by ratings desc, avg_score desc
limit 20;
