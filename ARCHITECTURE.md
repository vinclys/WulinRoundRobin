# Architecture notes · v7

## Shared-state model

The application stores one deterministic tournament state object in `public.tournaments.state` and keeps a separate numeric database row `version` for optimistic locking.

The state includes Categories, Pools, teams, Courts, Court routes, On Deck priority, preferred Courts, Round Robin matches, scores, standings inputs and the complete Playoff graph.

This model gives the event:

- atomic score and queue updates;
- no partially updated bracket on public screens;
- direct JSON export/import backup;
- simple multi-device conflict detection;
- exact history snapshots for recovery.

For this six-Court annual event, sending one moderate JSON row on each Realtime update is practical. A much larger multi-event platform should normalize matches and use smaller delta messages.

## v7 competition rules

### Standings

`calculateStandings()` uses:

1. win points;
2. direct head-to-head when exactly two teams are tied;
3. head-to-head mini-table when three or more teams are tied;
4. overall point differential;
5. overall points for;
6. team name only as a deterministic final fallback.

### Playoff seeding

`buildFirstRoundPairs()` explicitly handles the common two-Pool/top-two format:

```text
Pool A #1 vs Pool B #2
Pool A #2 vs Pool B #1
```

Larger brackets use seed ordering and opponent swaps to avoid same-Pool opening matches whenever a cross-Pool arrangement exists.

### Court routes

Each Court has:

```json
{
  "allowAllActive": false,
  "poolAccess": {
    "category-id": ["pool-a-id"]
  }
}
```

- Category access still uses `category.courtIds` for compatibility with v6.
- `poolAccess[categoryId] = ["*"]` means all Pools in that Category.
- Round Robin scheduling respects both Category and Pool.
- A cross-Pool Playoff match can use any Court opened to that Category.

### On Deck

`settings.prepareMatchIds` stores staff-priority matches. A queued match can also carry:

```json
{"preferredCourtId":"court4"}
```

Manual entries are displayed first and remain visible even when one team is currently playing. Automatic entries are then selected by Court route, avoiding duplicate teams and covering different configured Courts before adding a second entry for the same Court.

## Security boundaries

### Browser

- Contains only Supabase URL and publishable key.
- RLS permits SELECT of public events only.
- Never receives staff PIN, Session secret or Supabase secret key.

### Vercel Functions

- `/api/login` validates `ADMIN_PIN`.
- A signed 12-hour HttpOnly, SameSite cookie represents the staff session.
- `/api/state` verifies the cookie, same-origin request and event slug.
- Server-side Supabase secret key performs the write.

### Supabase

- `tournaments` has RLS enabled.
- Public roles receive SELECT only.
- `save_tournament_state` is executable only by the service role.
- The RPC checks the expected row version, saves atomically and writes history.

## Conflict behavior

1. Staff A and B both load row version 20.
2. A saves and creates version 21.
3. B attempts a save with expected version 20.
4. PostgreSQL raises `VERSION_CONFLICT`.
5. Vercel returns HTTP 409 with the latest cloud state.
6. B stores the attempted state as a local conflict backup and loads version 21.

This intentionally favors data safety over last-write-wins.

## Upgrade behavior

Existing v6 data is normalized in the browser:

- state format becomes version 7;
- missing `court.poolAccess` becomes `{}`;
- a Category already assigned to a Court defaults to all Pools until staff narrows it;
- missing `match.preferredCourtId` becomes an empty string.

The first successful v7 admin save writes the normalized state back to the same Supabase row. No destructive SQL migration is required.
