-- Optional pre-update backup. Run in Supabase SQL Editor and save the result.
select
  slug,
  name,
  version,
  is_public,
  updated_at,
  updated_by,
  jsonb_pretty(state) as state_json
from public.tournaments
where slug = 'wulin-annual-2026';
