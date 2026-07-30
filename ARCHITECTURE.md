# Architecture notes

## Why the live state is one JSONB row

The existing tournament engine already represents all categories, pools, teams, courts, queue priority, matches, scores and playoff links as one deterministic state object. The cloud version keeps that model in `tournaments.state` and adds a database `version`.

Advantages for this event:

- One score/queue operation is saved atomically.
- A Dashboard never receives a partially updated playoff bracket.
- Existing RR, playoff, third-place and score-correction logic remains unchanged.
- JSON export/import is a direct snapshot of the cloud state.
- Optimistic locking is simple: update only when `version = expectedVersion`.
- Historical rollback stores exact complete snapshots.

Trade-off:

- Every Realtime update sends the current state row rather than a small match delta.
- This is appropriate for a six-court annual event with a moderate audience.
- For a much larger public audience or multiple simultaneous tournaments, split matches into normalized tables and use Supabase Broadcast/delta events.

## Security boundaries

### Browser

- Contains only Supabase URL and publishable key.
- RLS permits SELECT of public tournaments only.
- Does not contain the staff PIN, Session secret or Supabase secret key.

### Vercel Functions

- `/api/login` validates the staff PIN stored in `ADMIN_PIN`.
- A signed 12-hour HttpOnly, SameSite cookie represents the staff session.
- `/api/state` verifies the cookie and event slug before any write.
- The Supabase secret key is used only here.

### Supabase

- `tournaments` has RLS enabled.
- Public roles receive SELECT only.
- `save_tournament_state` is executable by `service_role` only.
- The RPC performs an atomic version check, saves the new snapshot and records history.

## Conflict behavior

1. Staff device A and B both load version 10.
2. A saves and creates version 11.
3. B attempts to save with expected version 10.
4. PostgreSQL updates zero rows and raises `VERSION_CONFLICT`.
5. Vercel returns HTTP 409 with the latest cloud state.
6. B keeps its attempted state in a local conflict backup, loads version 11, and asks the operator to repeat the intended action.

This favors data safety over last-write-wins.

## Offline behavior

- Public screens continue showing the most recent local cache.
- A previously authenticated staff screen can continue making local edits while offline.
- Pending state and its expected cloud version are persisted locally.
- On reconnection, the app saves only if the cloud version is unchanged.
- If another device changed the event while offline, the app stops and reports a conflict.


## v6 state additions

The existing JSONB state now also carries `settings.prepareLimit`, `settings.courts[].allowAllActive`, and `categories[].active`. No relational schema migration is required.
