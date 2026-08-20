-- Optional: create an isolated Preview event by copying the current production state.
-- Safe to rerun: it deletes only the dedicated v8 preview slug first.
begin;

delete from public.tournaments
where slug = 'wulin-annual-2026-v8-preview';

insert into public.tournaments (slug, name, state, version, is_public, updated_by)
select
  'wulin-annual-2026-v8-preview',
  name || ' · v8 Preview',
  state,
  1,
  true,
  'v8-preview-copy'
from public.tournaments
where slug = 'wulin-annual-2026';

insert into public.tournament_state_history (tournament_id, version, state, actor)
select id, version, state, 'v8-preview-copy'
from public.tournaments
where slug = 'wulin-annual-2026-v8-preview'
on conflict (tournament_id, version) do nothing;

commit;
