-- Post-deployment checks for a new Wulin Tournament Control v7 Supabase project.

select
  slug,
  name,
  version as cloud_row_version,
  state ->> 'version' as app_state_version,
  is_public,
  jsonb_array_length(coalesce(state #> '{settings,courts}', '[]'::jsonb)) as court_count,
  updated_at,
  updated_by
from public.tournaments
where slug = 'wulin-annual-2026';

select policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename = 'tournaments';

select pubname, schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'tournaments';

select h.version, h.actor, h.created_at
from public.tournament_state_history h
join public.tournaments t on t.id = h.tournament_id
where t.slug = 'wulin-annual-2026'
order by h.version desc
limit 10;
