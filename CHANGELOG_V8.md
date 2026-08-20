# v8 Cloud Changelog

## Three-Pool Playoff

- Detects exactly three participating Pools with two qualifiers from each Pool.
- Builds one cross-Pool six-team seed ranking.
- Automatic order: Win Points → same-Pool H2H precedence → Point Difference → Points For.
- Seed 1 and Seed 2 receive byes.
- QF1: Seed 3 vs Seed 6.
- QF2: Seed 4 vs Seed 5.
- SF1: Seed 1 vs QF2 winner.
- SF2: Seed 2 vs QF1 winner.
- Final: SF1 winner vs SF2 winner.
- Optional Third Place Match remains supported.
- Admin can move any qualifier up or down and regenerate the Playoff.

## TV 1

- Replaces one global Completed / Queue count with per-Active-Category progress cards.
- Each card displays Done / Total, Queue and Live counts.
- Expected Court badge is larger for AirPlay viewing.
- iPad landscape keeps On Deck and six Live Courts in the same split-screen layout.

## Admin

- Score Corrections moved to the bottom of the page.
- Corrections are grouped in collapsed Category sections.
- Open correction group remains open after a score is saved.

## State Format

```text
state.version = 8
categories[].playoffSeedOrder
matches[].bracketY
```

No relational Supabase table migration is required for an existing deployment.
