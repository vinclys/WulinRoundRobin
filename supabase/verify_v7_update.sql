-- Run after the first successful v7 Staff Admin save.
-- No schema migration is required; v7 fields live in tournaments.state JSONB.

select
  slug,
  version as cloud_row_version,
  state ->> 'version' as app_state_version,
  state #>> '{settings,prepareLimit}' as on_deck_limit,
  jsonb_array_length(coalesce(state -> 'categories', '[]'::jsonb)) as category_count,
  jsonb_array_length(coalesce(state -> 'matches', '[]'::jsonb)) as match_count,
  jsonb_array_length(coalesce(state #> '{settings,courts}', '[]'::jsonb)) as court_count,
  (
    select count(*)
    from jsonb_array_elements(coalesce(state #> '{settings,courts}', '[]'::jsonb)) court
    where jsonb_typeof(court -> 'poolAccess') = 'object'
  ) as courts_with_v7_pool_access_shape,
  (
    select count(*)
    from jsonb_array_elements(coalesce(state -> 'matches', '[]'::jsonb)) match
    where match ? 'preferredCourtId'
  ) as matches_with_preferred_court_field,
  (
    select count(*)
    from jsonb_array_elements(coalesce(state -> 'matches', '[]'::jsonb)) match
    where coalesce(match ->> 'preferredCourtId', '') <> ''
  ) as matches_with_expected_court,
  updated_at,
  updated_by
from public.tournaments
where slug = 'wulin-annual-2026';

-- Review Court Category/Pool routes.
select
  court ->> 'id' as court_id,
  court ->> 'name' as court_name,
  coalesce((court ->> 'allowAllActive')::boolean, false) as allow_all_active,
  jsonb_pretty(coalesce(court -> 'poolAccess', '{}'::jsonb)) as pool_access
from public.tournaments t
cross join lateral jsonb_array_elements(coalesce(t.state #> '{settings,courts}', '[]'::jsonb)) court
where t.slug = 'wulin-annual-2026'
order by court ->> 'id';

-- Confirm public read security remains enabled.
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual
from pg_policies
where schemaname = 'public'
  and tablename = 'tournaments'
order by policyname;

-- Confirm Realtime is still enabled for the tournament state table.
select pubname, schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'tournaments';

-- Confirm recent snapshots continue to be written.
select h.version, h.actor, h.created_at
from public.tournament_state_history h
join public.tournaments t on t.id = h.tournament_id
where t.slug = 'wulin-annual-2026'
order by h.version desc
limit 10;
