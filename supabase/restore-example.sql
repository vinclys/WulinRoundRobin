-- Emergency rollback example. Run only after replacing TARGET_VERSION.
-- This directly restores a historical snapshot and advances the live version.
-- Prefer taking a fresh JSON export from the app before using this.

begin;

with target as (
  select h.tournament_id, h.state
  from public.tournament_state_history h
  join public.tournaments t on t.id = h.tournament_id
  where t.slug = 'wulin-annual-2026'
    and h.version = TARGET_VERSION
), restored as (
  update public.tournaments t
     set state = target.state,
         version = t.version + 1,
         updated_at = now(),
         updated_by = 'manual-restore'
    from target
   where t.id = target.tournament_id
  returning t.id, t.version, t.state
)
insert into public.tournament_state_history (tournament_id, version, state, actor)
select id, version, state, 'manual-restore'
from restored;

commit;
