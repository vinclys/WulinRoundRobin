# Wulin Tournament Control v8 · Architecture

## 1. Runtime topology

```text
TV 1 / TV 2 / public phones
        │
        ├── Supabase public SELECT + Realtime subscription
        │
Staff Admin browser
        │
        └── same-origin Vercel API Functions
                 ├── PIN login and signed HttpOnly session
                 ├── state validation
                 ├── optimistic version check
                 └── Supabase server-side secret key
```

The shared source of truth is one row in `public.tournaments`. Its `state` JSONB contains Categories, Pools, Teams, Courts, queue priority, Round Robin matches, Playoff links, scores, TV settings and Admin routing settings. The relational `version` column is separate from `state.version` and is used for optimistic locking.

This snapshot model fits a six-court annual event because one scheduling or score action is committed atomically. Public screens never receive a half-updated standings table or bracket, JSON export/import is an exact event backup, and complete versions can be restored from history.

The trade-off is payload size: each Realtime update replaces the event snapshot rather than sending a small match delta. For the current event size this keeps the rule engine deterministic and operationally simple. A future multi-event platform with hundreds of concurrent courts should normalize matches and publish smaller changes.

## 2. Update model and live-screen behavior

- Staff actions save a complete state snapshot through `/api/state`.
- Supabase Realtime broadcasts the changed tournament row.
- TV 1, TV 2 and other browsers normalize and render the newest version.
- The header keeps the last known state visible while reconnecting.
- Public screens distinguish connecting, synced, cached/offline and error states.
- A browser cache keeps the latest known good screen visible during short Wi-Fi interruptions.
- Staff changes that have not reached the server are kept as a local pending or conflict backup.

TV 1 is designed for iPad landscape AirPlay. The first scan should answer:

1. Which Categories are active and how far along is each one?
2. Which teams are On Deck and which Court should they approach?
3. Who is currently playing on Courts 1–6?

TV 2 is designed for results and awards. The first scan should answer:

1. What is the complete Pool standing?
2. What tie-break determined the order?
3. How did teams advance through the Playoff bracket?
4. Who is Champion, Runner-up, Third and Fourth?

## 3. Security boundaries

### Browser

- Contains only the Supabase URL and publishable key.
- RLS permits public SELECT only for `is_public=true` events.
- Does not contain the Admin PIN, session secret or Supabase secret key.
- Staff writes do not call Supabase directly.

### Vercel Functions

- `/api/login` compares the submitted PIN with `ADMIN_PIN`.
- A signed 12-hour HttpOnly, SameSite cookie represents the staff session.
- `/api/state` verifies same-origin request metadata, the staff session, event slug and expected cloud version.
- The Supabase secret or legacy service-role key remains server-side.
- Request size and state shape are validated before the database RPC is called.

### Supabase

- `tournaments` and `tournament_state_history` have RLS enabled.
- Public roles receive read-only access to public events.
- `save_tournament_state(...)` is callable only by the server role.
- The RPC performs one atomic expected-version update and writes a history snapshot.
- The newest 250 snapshots per event are retained by the cleanup trigger.

## 4. Version and conflict behavior

Two version values have different purposes:

```text
public.tournaments.version  cloud row revision; increases on every save
state.version               application state format; v8 is 8
```

Conflict example:

1. Staff devices A and B both load cloud revision 40.
2. A saves first and creates revision 41.
3. B attempts to save with expected revision 40.
4. PostgreSQL returns `VERSION_CONFLICT`.
5. Vercel responds with HTTP 409 and the newest cloud snapshot.
6. B stores its attempted snapshot locally, loads revision 41 and asks staff to repeat the intended operation.

The system intentionally rejects last-write-wins behavior so that a late score entry cannot silently overwrite another court's newer work.

## 5. Offline and degraded operation

- Public screens retain the latest browser cache and show a stale/offline status instead of blanking the dashboard.
- Staff may continue seeing the latest state, but a save is not reported as successful until the server confirms it.
- A pending staff change is retried only when its expected cloud version is still current.
- If another device changed the event during the outage, the pending write is stopped and preserved as a conflict backup.
- The recommended event-day operating model is one primary scoring/scheduling workstation, optional secondary staff devices for inspection, and read-only televisions.
- The JSON export remains the fastest human-operated recovery path if venue connectivity is lost for an extended period.

## 6. v7 routing fields retained in v8

```text
settings.courts[].poolAccess
matches[].prepareCourtId
```

### `poolAccess`

A Court first receives Category access from `category.courtIds` or `court.allowAllActive`. For Round Robin matches, `court.poolAccess` may narrow that Category to selected Pools:

```json
{
  "cat_mens": ["pool_a"]
}
```

- Category key absent: all Pools in that Category are allowed.
- Category key with Pool IDs: only those Pools are allowed.
- Category key with an empty array: no Round Robin Pool in that Category is allowed.
- Playoff matches do not belong to one Pool; any Court enabled for the Category may host them.

### `prepareCourtId`

A queued match can store an advisory future Court. TV 1 displays it as `PREPARE FOR COURT N`, but the match remains queued until staff actually assigns it to a Court. A manual On Deck match may remain visible even while one of its teams is finishing another match.

## 7. v8 state additions

```text
state.version = 8
categories[].playoffSeedOrder
matches[].bracketY
```

### `playoffSeedOrder`

For exactly three Pools with two qualifiers from each Pool, the engine produces six cross-Pool seeds. `playoffSeedOrder` stores a complete staff-approved order of six team IDs. An empty array means use automatic order.

Automatic comparison:

```text
1. Win Points
2. Head-to-Head when tied teams actually met in the same Pool
3. Point Difference
4. Points For
5. Stable Pool/name fallback only if all official values remain equal
```

Teams from different Pools do not have a direct Head-to-Head result. The engine therefore preserves same-Pool H2H precedence where it exists and uses DIFF/PF between teams that never met. Staff can adjust any ambiguous cross-Pool order before generating the bracket.

The six-team path is fixed:

```text
QF1  Seed 3 vs Seed 6
QF2  Seed 4 vs Seed 5
SF1  Seed 1 vs Winner QF2
SF2  Seed 2 vs Winner QF1
Final Winner SF1 vs Winner SF2
```

Seed 1 and Seed 2 receive byes. The optional Third Place Match still receives the two Semifinal losers.

### `bracketY`

Six-team Playoffs have two teams entering directly at the Semifinal stage. `bracketY` gives the visual bracket a stable vertical coordinate so the connector paths accurately show QF winners advancing to the correct Seed 1 or Seed 2 branch.

## 8. Rule-engine modules

High-risk tournament rules are isolated in `src/tournament-core.js` and tested without a browser:

- Round Robin standings and two-team / multi-team H2H tie-breaks;
- two-Pool crossover Semifinals;
- three-Pool six-seed ranking and manual override;
- six-team QF/SF path;
- Court Category + Pool access;
- automatic On Deck selection per eligible Court;
- manual On Deck behavior for currently playing teams.

Browser orchestration, rendering and state normalization remain in `src/app.js`. Server-side trust boundaries remain in `server/` and `api/`.

## 9. Rendering and maintenance budget

The dashboards use semantic HTML and CSS rather than Canvas or WebGL because the visible mark count is small: at most six On Deck cards, six Live Court cards, a few Category progress cards and one Playoff bracket. This keeps text crisp on AirPlay, supports browser zoom, and makes touch controls and accessibility labels straightforward.

Performance safeguards:

- full re-render only after a confirmed local action or Realtime snapshot;
- no continuous animation loop;
- no polling while Realtime is connected;
- compact snapshot data suitable for venue Wi-Fi;
- collapsed low-frequency Admin sections, especially Score Corrections;
- stable TV layout so live updates do not move the primary panels unnecessarily.

For future growth, monitor serialized state size, Realtime frequency and simultaneous public clients. Normalizing matches becomes appropriate when event snapshots or update rates materially exceed the current annual-tournament scale.
