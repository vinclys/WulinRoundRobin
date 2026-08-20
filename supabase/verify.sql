-- Optional post-deployment checks in Supabase SQL Editor.
select slug, name, version, is_public, updated_at, updated_by
from public.tournaments
where slug = 'wulin-annual-2026';

select policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'tournaments';

select pubname, schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'tournaments';

select tournament_id, version, actor, created_at
from public.tournament_state_history
order by created_at desc
limit 10;

-- v8 application-state fields. Existing deployments show v8 after the first
-- successful staff save from the upgraded app.
select
  slug,
  version as cloud_row_version,
  state ->> 'version' as app_state_version,
  state #>> '{settings,prepareLimit}' as prepare_limit,
  jsonb_array_length(coalesce(state #> '{settings,courts}', '[]'::jsonb)) as court_count,
  jsonb_array_length(coalesce(state -> 'categories', '[]'::jsonb)) as category_count
from public.tournaments
where slug = 'wulin-annual-2026';
