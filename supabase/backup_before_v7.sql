-- Read-only backup queries before deploying Wulin Tournament Control v7.
-- Run in Supabase Dashboard > SQL Editor and download/copy the results.

select
  slug,
  name,
  version as cloud_row_version,
  state ->> 'version' as app_state_version,
  is_public,
  updated_at,
  updated_by,
  jsonb_pretty(state) as state_json
from public.tournaments
where slug = 'wulin-annual-2026';

-- Record the most recent history versions available for emergency recovery.
select
  h.version,
  h.actor,
  h.created_at,
  jsonb_array_length(coalesce(h.state -> 'categories', '[]'::jsonb)) as category_count,
  jsonb_array_length(coalesce(h.state -> 'matches', '[]'::jsonb)) as match_count
from public.tournament_state_history h
join public.tournaments t on t.id = h.tournament_id
where t.slug = 'wulin-annual-2026'
order by h.version desc
limit 25;
