-- Verify the existing Supabase event after deploying the v6 frontend.
-- The state is JSONB, so no table migration is required.
select
  slug,
  version as cloud_row_version,
  state ->> 'version' as app_state_version,
  state #>> '{settings,prepareLimit}' as on_deck_limit,
  jsonb_array_length(coalesce(state -> 'categories', '[]'::jsonb)) as category_count,
  jsonb_array_length(coalesce(state #> '{settings,courts}', '[]'::jsonb)) as court_count,
  updated_at,
  updated_by
from public.tournaments
where slug = 'wulin-annual-2026';

-- Confirm Realtime publication remains enabled.
select pubname, schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'tournaments';
