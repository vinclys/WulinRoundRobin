-- OPTIONAL cleanup after v7 Preview testing.
-- This deletes ONLY the preview event. History is removed by ON DELETE CASCADE.

delete from public.tournaments
where slug = 'wulin-annual-2026-v7-preview';

select slug, name, version, updated_at
from public.tournaments
where slug in ('wulin-annual-2026', 'wulin-annual-2026-v7-preview')
order by slug;
