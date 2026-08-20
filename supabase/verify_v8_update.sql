-- Verify an existing Supabase event after the first successful v8 staff save.
-- v8 stores all additions inside the existing JSONB state; no ALTER TABLE is required.
select
  slug,
  version as cloud_row_version,
  state ->> 'version' as app_state_version,
  state #>> '{settings,prepareLimit}' as on_deck_limit,
  jsonb_array_length(coalesce(state -> 'categories', '[]'::jsonb)) as category_count,
  jsonb_array_length(coalesce(state #> '{settings,courts}', '[]'::jsonb)) as court_count,
  (
    select count(*)
    from jsonb_array_elements(coalesce(state -> 'categories', '[]'::jsonb)) as category
    where jsonb_typeof(category -> 'playoffSeedOrder') = 'array'
  ) as categories_with_seed_order_field,
  (
    select count(*)
    from jsonb_array_elements(coalesce(state -> 'matches', '[]'::jsonb)) as match
    where match ? 'bracketY'
  ) as custom_six_seed_bracket_matches,
  (
    select count(*)
    from jsonb_array_elements(coalesce(state #> '{settings,courts}', '[]'::jsonb)) as court
    where jsonb_typeof(court -> 'poolAccess') = 'object'
  ) as courts_with_pool_access_field,
  updated_at,
  updated_by
from public.tournaments
where slug = 'wulin-annual-2026';

-- Confirm the existing tournament table is still published to Supabase Realtime.
select pubname, schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'tournaments';
