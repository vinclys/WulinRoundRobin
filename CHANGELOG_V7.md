# v7 Cloud Changelog

## Competition logic

- Two Pools with two qualifiers each now generate cross-pool semifinals:
  - Pool A #1 vs Pool B #2
  - Pool A #2 vs Pool B #1
- Round Robin tie-break order is now:
  1. Win points
  2. Direct head-to-head for a two-team tie
  3. Head-to-head mini-table for a 3+ team tie
  4. Overall point differential
  5. Overall points for
  6. Team name as deterministic final fallback
- Existing Playoff matches are not silently rewritten during upgrade. Staff must use **REGENERATE PLAYOFF** after checking the full standings.

## Public displays

- TV 2 uses a graphical branch-style Playoff bracket instead of a flat game list.
- Bracket cards show original Pool seed, live/final status, score, winner advancement, Final and Third Place.
- TV 1 has a compact iPad landscape/AirPlay layout with larger On Deck and Live Court names.
- TV 1 displays expected Court for each On Deck match.

## Court and On Deck routing

- Each Court can accept selected Active Categories and selected Pools.
- Cross-pool Playoff matches may use any Court opened to the Category.
- Automatic On Deck fills by Court route, one match per configured Court first.
- Staff-priority On Deck matches can be assigned a future/expected Court.
- Staff-priority matches remain visible while one of their teams is still playing another match.

## Staff Admin

- English-first operational language with Chinese supporting labels.
- Full standings for every Pool are shown in Playoff setup.
- Expected opening-round pairings are shown before Playoff generation.
- Existing six-Court 3 × 2 control, score correction, Active Categories, Cat/Pool tabs, Realtime and version conflict protection remain.

## Cloud state additions

```text
state.version = 7
settings.courts[].poolAccess
matches[].preferredCourtId
```

No relational Supabase schema migration is required for an existing deployment because these values live in the current JSONB state.
