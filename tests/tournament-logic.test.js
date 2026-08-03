import test from "node:test";
import assert from "node:assert/strict";
import { calculateStandings, buildFirstRoundPairs } from "../src/tournament-logic.js";

function done(teamAId, teamBId, scoreA, scoreB, finishedAt = 1) {
  return { teamAId, teamBId, scoreA, scoreB, status: "done", finishedAt };
}

test("two teams tied on win points are ordered by their direct head-to-head result before overall differential", () => {
  const teams = [
    { id: "cai", name: "Cai / Larry" },
    { id: "vin", name: "Vin / Greg" },
    { id: "third", name: "Third Team" },
    { id: "fourth", name: "Fourth Team" },
  ];

  const matches = [
    // Direct match: Cai / Larry beat Vin / Greg.
    done("cai", "vin", 11, 8, 10),
    // Both finish with two wins (4 points), but Vin gets a much larger
    // overall point differential. Head-to-head must still put Cai first.
    done("cai", "third", 11, 9, 20),
    done("fourth", "cai", 11, 0, 30),
    done("vin", "third", 11, 0, 40),
    done("vin", "fourth", 11, 0, 50),
    done("third", "fourth", 11, 9, 60),
  ];

  const standings = calculateStandings(teams, matches);
  const tied = standings.filter((row) => row.points === 4);

  assert.equal(tied[0].teamId, "cai");
  assert.equal(tied[1].teamId, "vin");
  assert.equal(tied[0].tieBreakLabel, "H2H WIN");
  assert.equal(tied[0].tieBreakDetail, "11-8");
  assert.ok(tied[0].diff < tied[1].diff, "fixture should prove H2H overrides overall differential");
});

test("three-team tie uses head-to-head mini-table before overall differential", () => {
  const teams = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
    { id: "d", name: "D" },
  ];
  const matches = [
    done("a", "b", 11, 5),
    done("b", "c", 11, 9),
    done("c", "a", 11, 10),
    done("a", "d", 11, 9),
    done("b", "d", 11, 0),
    done("c", "d", 11, 0),
  ];

  const standings = calculateStandings(teams, matches);
  assert.deepEqual(standings.slice(0, 3).map((row) => row.teamId), ["a", "c", "b"]);
  assert.equal(standings[0].tieBreakLabel, "H2H MINI");
});

test("two pools with two qualifiers create cross-pool semifinals", () => {
  const pools = [
    { id: "poolA", name: "Pool A" },
    { id: "poolB", name: "Pool B" },
  ];
  const qualifiers = [
    { teamId: "A1", poolId: "poolA", poolName: "Pool A", rank: 1, points: 6, diff: 12, scored: 33 },
    { teamId: "A2", poolId: "poolA", poolName: "Pool A", rank: 2, points: 4, diff: 5, scored: 30 },
    { teamId: "B1", poolId: "poolB", poolName: "Pool B", rank: 1, points: 6, diff: 10, scored: 32 },
    { teamId: "B2", poolId: "poolB", poolName: "Pool B", rank: 2, points: 4, diff: 2, scored: 29 },
  ];

  const pairs = buildFirstRoundPairs(pools, qualifiers, 4);
  assert.deepEqual(pairs.map((pair) => pair.map((seed) => seed.teamId)), [
    ["A1", "B2"],
    ["A2", "B1"],
  ]);
});

test("point differential is used after head-to-head only when no direct completed game is available", () => {
  const teams = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
    { id: "d", name: "D" },
  ];
  const matches = [
    done("a", "c", 11, 10),
    done("d", "a", 11, 9),
    done("b", "c", 11, 2),
    done("d", "b", 11, 10),
  ];

  const standings = calculateStandings(teams, matches);
  const a = standings.find((row) => row.teamId === "a");
  const b = standings.find((row) => row.teamId === "b");
  assert.equal(a.points, b.points);
  assert.equal(b.tieBreakLabel, "");
  assert.ok(standings.indexOf(b) < standings.indexOf(a));
  assert.ok(b.diff > a.diff);
});

test("generic first-round seeding avoids same-pool matchups when a cross-pool swap exists", () => {
  const pools = [
    { id: "a", name: "Pool A" },
    { id: "b", name: "Pool B" },
    { id: "c", name: "Pool C" },
  ];
  const qualifiers = [
    { teamId: "A1", poolId: "a", rank: 1, points: 6, diff: 10, scored: 33 },
    { teamId: "B1", poolId: "b", rank: 1, points: 6, diff: 9, scored: 32 },
    { teamId: "C1", poolId: "c", rank: 1, points: 6, diff: 8, scored: 31 },
    { teamId: "A2", poolId: "a", rank: 2, points: 4, diff: 5, scored: 30 },
    { teamId: "B2", poolId: "b", rank: 2, points: 4, diff: 4, scored: 29 },
    { teamId: "C2", poolId: "c", rank: 2, points: 4, diff: 3, scored: 28 },
  ];

  const pairs = buildFirstRoundPairs(pools, qualifiers, 8);
  const realPairs = pairs.filter(([left, right]) => left.teamId !== "BYE" && right.teamId !== "BYE");
  assert.equal(realPairs.some(([left, right]) => left.poolId === right.poolId), false);
});
