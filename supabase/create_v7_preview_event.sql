-- OPTIONAL: create an isolated v7 Preview event by cloning the current Production state.
-- This script deletes/recreates ONLY the preview slug below.
-- Production slug wulin-annual-2026 is never modified.

begin;

delete from public.tournaments
where slug = 'wulin-annual-2026-v7-preview';

insert into public.tournaments (
  slug,
  name,
  state,
  version,
  is_public,
  updated_at,
  updated_by
)
select
  'wulin-annual-2026-v7-preview',
  name || ' · v7 Preview',
  state,
  1,
  true,
  now(),
  'v7-preview-clone'
from public.tournaments
where slug = 'wulin-annual-2026';

insert into public.tournament_state_history (
  tournament_id,
  version,
  state,
  actor
)
select
  id,
  version,
  state,
  'v7-preview-clone'
from public.tournaments
where slug = 'wulin-annual-2026-v7-preview'
on conflict (tournament_id, version) do nothing;

commit;

select
  slug,
  name,
  version as cloud_row_version,
  state ->> 'version' as copied_app_state_version,
  updated_at,
  updated_by
from public.tournaments
where slug in ('wulin-annual-2026', 'wulin-annual-2026-v7-preview')
order by slug;
