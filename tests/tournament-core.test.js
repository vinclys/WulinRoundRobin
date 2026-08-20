import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlayoffBracketPlan,
  computePoolStandings,
  isPoolAllowed,
  rankCrossPoolQualifiers,
  selectOnDeckEntries,
} from "../src/tournament-core.js";

test("two-team points tie is decided by head-to-head before point differential", () => {
  const teams = [
    { id: "cai", name: "Cai / Larry" },
    { id: "vin", name: "Vin / Greg" },
    { id: "alpha", name: "Alpha" },
    { id: "beta", name: "Beta" },
  ];
  const matches = [
    { id: "m1", status: "done", teamAId: "cai", teamBId: "vin", scoreA: 11, scoreB: 9 },
    { id: "m2", status: "done", teamAId: "cai", teamBId: "alpha", scoreA: 2, scoreB: 11 },
    { id: "m3", status: "done", teamAId: "cai", teamBId: "beta", scoreA: 11, scoreB: 9 },
    { id: "m4", status: "done", teamAId: "vin", teamBId: "alpha", scoreA: 11, scoreB: 0 },
    { id: "m5", status: "done", teamAId: "vin", teamBId: "beta", scoreA: 11, scoreB: 0 },
  ];

  const standings = computePoolStandings(teams, matches);
  const cai = standings.find((row) => row.teamId === "cai");
  const vin = standings.find((row) => row.teamId === "vin");

  assert.equal(cai.points, vin.points);
  assert.ok(vin.diff > cai.diff, "fixture must give Vin the better point differential");
  assert.deepEqual(standings.slice(0, 2).map((row) => row.teamId), ["cai", "vin"]);
  assert.match(cai.tieBreakNote, /^H2H W/);
  assert.match(vin.tieBreakNote, /^H2H L/);
});

test("three-team points tie uses a head-to-head mini table", () => {
  const teams = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
    { id: "d", name: "D" },
    { id: "e", name: "E" },
  ];
  const matches = [
    { status: "done", teamAId: "a", teamBId: "b", scoreA: 11, scoreB: 8 },
    { status: "done", teamAId: "a", teamBId: "c", scoreA: 11, scoreB: 7 },
    { status: "done", teamAId: "d", teamBId: "a", scoreA: 11, scoreB: 9 },
    { status: "done", teamAId: "b", teamBId: "c", scoreA: 11, scoreB: 9 },
    { status: "done", teamAId: "b", teamBId: "d", scoreA: 11, scoreB: 4 },
    { status: "done", teamAId: "c", teamBId: "d", scoreA: 11, scoreB: 0 },
    { status: "done", teamAId: "c", teamBId: "e", scoreA: 11, scoreB: 1 },
  ];

  const standings = computePoolStandings(teams, matches);
  assert.deepEqual(standings.slice(0, 3).map((row) => row.teamId), ["a", "b", "c"]);
  assert.deepEqual(standings.slice(0, 3).map((row) => row.h2hPoints), [4, 2, 0]);
});


test("two pools with two qualifiers generate crossover semifinals", () => {
  const pools = [
    { id: "poolA", name: "Pool A" },
    { id: "poolB", name: "Pool B" },
  ];
  const qualifiers = [
    { teamId: "A1", poolId: "poolA", poolName: "Pool A", rank: 1, points: 6, diff: 20, scored: 33 },
    { teamId: "A2", poolId: "poolA", poolName: "Pool A", rank: 2, points: 4, diff: 8, scored: 30 },
    { teamId: "B1", poolId: "poolB", poolName: "Pool B", rank: 1, points: 6, diff: 18, scored: 33 },
    { teamId: "B2", poolId: "poolB", poolName: "Pool B", rank: 2, points: 4, diff: 7, scored: 29 },
  ];

  const plan = buildPlayoffBracketPlan(pools, qualifiers);
  assert.equal(plan.strategy, "two-pool-crossover");
  assert.equal(plan.bracketSize, 4);
  assert.deepEqual(
    plan.firstPairs.map((pair) => pair.map((team) => team.teamId)),
    [["A1", "B2"], ["A2", "B1"]],
  );
});

test("three pools with two qualifiers create six cross-pool seeds and the requested QFs", () => {
  const pools = [
    { id: "A", name: "Pool A" },
    { id: "B", name: "Pool B" },
    { id: "C", name: "Pool C" },
  ];
  const qualifiers = [
    { teamId: "A1", name: "A1", poolId: "A", poolName: "Pool A", rank: 1, points: 6, diff: 5, scored: 30 },
    { teamId: "A2", name: "A2", poolId: "A", poolName: "Pool A", rank: 2, points: 4, diff: 20, scored: 31 },
    { teamId: "B1", name: "B1", poolId: "B", poolName: "Pool B", rank: 1, points: 6, diff: 10, scored: 32 },
    { teamId: "B2", name: "B2", poolId: "B", poolName: "Pool B", rank: 2, points: 4, diff: 15, scored: 30 },
    { teamId: "C1", name: "C1", poolId: "C", poolName: "Pool C", rank: 1, points: 6, diff: 8, scored: 31 },
    { teamId: "C2", name: "C2", poolId: "C", poolName: "Pool C", rank: 2, points: 4, diff: 5, scored: 28 },
  ];

  const plan = buildPlayoffBracketPlan(pools, qualifiers);
  assert.equal(plan.strategy, "three-pool-six-seed");
  assert.deepEqual(plan.ordered.map((team) => team.teamId), ["B1", "C1", "A1", "A2", "B2", "C2"]);
  assert.deepEqual(
    plan.firstPairs.map((pair) => pair.map((team) => team.teamId)),
    [["A1", "C2"], ["A2", "B2"]],
  );
  assert.deepEqual(plan.ordered.slice(0, 2).map((team) => team.seedNumber), [1, 2]);
});

test("cross-pool ranking preserves same-pool H2H order before DIFF", () => {
  const pools = [{ id: "A" }, { id: "B" }, { id: "C" }];
  const qualifiers = [
    { teamId: "A1", name: "A1", poolId: "A", rank: 1, points: 6, h2hPoints: 2, diff: -10, scored: 25 },
    { teamId: "A2", name: "A2", poolId: "A", rank: 2, points: 6, h2hPoints: 0, diff: 50, scored: 50 },
    { teamId: "B1", name: "B1", poolId: "B", rank: 1, points: 6, diff: 40, scored: 45 },
    { teamId: "C1", name: "C1", poolId: "C", rank: 1, points: 6, diff: 30, scored: 42 },
  ];

  const ranking = rankCrossPoolQualifiers(pools, qualifiers);
  const ids = ranking.ordered.map((team) => team.teamId);
  assert.ok(ids.indexOf("A1") < ids.indexOf("A2"), "same-pool H2H winner must stay ahead of the loser");
  assert.deepEqual(ids, ["B1", "C1", "A1", "A2"]);
});

test("valid manual six-seed order overrides automatic cross-pool ranking", () => {
  const pools = [{ id: "A" }, { id: "B" }, { id: "C" }];
  const qualifiers = [
    { teamId: "A1", poolId: "A", rank: 1, points: 6, diff: 5, scored: 30 },
    { teamId: "A2", poolId: "A", rank: 2, points: 4, diff: 4, scored: 29 },
    { teamId: "B1", poolId: "B", rank: 1, points: 6, diff: 8, scored: 32 },
    { teamId: "B2", poolId: "B", rank: 2, points: 4, diff: 3, scored: 28 },
    { teamId: "C1", poolId: "C", rank: 1, points: 6, diff: 7, scored: 31 },
    { teamId: "C2", poolId: "C", rank: 2, points: 4, diff: 2, scored: 27 },
  ];
  const manual = ["C1", "A1", "B1", "C2", "A2", "B2"];
  const plan = buildPlayoffBracketPlan(pools, qualifiers, { manualSeedOrder: manual });
  assert.equal(plan.manualApplied, true);
  assert.deepEqual(plan.ordered.map((team) => team.teamId), manual);
  assert.deepEqual(plan.firstPairs.map((pair) => pair.map((team) => team.teamId)), [["B1", "B2"], ["C2", "A2"]]);
});

test("pool access treats an absent category key as all pools and an empty list as no RR pool", () => {
  assert.equal(isPoolAllowed({}, "men", "poolA"), true);
  assert.equal(isPoolAllowed({ men: ["poolA"] }, "men", "poolA"), true);
  assert.equal(isPoolAllowed({ men: ["poolA"] }, "men", "poolB"), false);
  assert.equal(isPoolAllowed({ men: [] }, "men", "poolA"), false);
  assert.equal(isPoolAllowed({ men: [] }, "men", ""), true, "playoff/no-pool matches remain allowed");
});

test("automatic On Deck follows each court Category and Pool assignment", () => {
  const categories = [
    { id: "men", active: true, courtIds: ["court1", "court2"], pools: [{ id: "A" }, { id: "B" }] },
    { id: "women", active: true, courtIds: ["court3"], pools: [{ id: "W" }] },
  ];
  const courts = [
    { id: "court1", poolAccess: { men: ["A"] } },
    { id: "court2", poolAccess: { men: ["B"] } },
    { id: "court3", poolAccess: { women: ["W"] } },
  ];
  const matches = [
    { id: "menA", catId: "men", poolId: "A", stage: "RR", status: "queued", teamAId: "a1", teamBId: "a2", sequence: 1 },
    { id: "menB", catId: "men", poolId: "B", stage: "RR", status: "queued", teamAId: "b1", teamBId: "b2", sequence: 2 },
    { id: "womenW", catId: "women", poolId: "W", stage: "RR", status: "queued", teamAId: "w1", teamBId: "w2", sequence: 3 },
  ];

  const entries = selectOnDeckEntries({ matches, categories, courts, manualMatchIds: [], limit: 3 });
  assert.deepEqual(
    entries.map((entry) => [entry.match.id, entry.courtId]),
    [["menA", "court1"], ["menB", "court2"], ["womenW", "court3"]],
  );
});

test("manual On Deck keeps a future match visible when one team is still playing", () => {
  const categories = [
    { id: "men", active: true, courtIds: ["court1"], pools: [{ id: "A" }] },
  ];
  const courts = [{ id: "court1", poolAccess: { men: ["A"] } }];
  const matches = [
    { id: "live", catId: "men", poolId: "A", stage: "RR", status: "playing", teamAId: "a1", teamBId: "a2", courtId: "court1", sequence: 1 },
    { id: "future", catId: "men", poolId: "A", stage: "RR", status: "queued", teamAId: "a1", teamBId: "a3", prepareCourtId: "court1", sequence: 2 },
  ];

  const entries = selectOnDeckEntries({ matches, categories, courts, manualMatchIds: ["future"], limit: 3 });
  assert.equal(entries[0].match.id, "future");
  assert.equal(entries[0].courtId, "court1");
  assert.equal(entries[0].manual, true);
  assert.equal(entries[0].teamsBusy, true);
});
