import test from "node:test";
import assert from "node:assert/strict";
import { validateTournamentState } from "../server/validate-state.js";

test("v8 state accepts active categories, pool-aware courts and potential courts", () => {
  const state = {
    version: 8,
    settings: {
      eventName: "Wulin Annual Tournament",
      autoNext: true,
      prepareLimit: 6,
      dashboardCatIds: ["cat1"],
      prepareMatchIds: ["match1"],
      courts: Array.from({ length: 6 }, (_, index) => ({
        id: `court${index + 1}`,
        name: `Court ${index + 1}`,
        allowAllActive: false,
        poolAccess: index === 0 ? { cat1: ["poolA"] } : {},
      })),
    },
    categories: [{
      id: "cat1",
      name: "Men's Doubles",
      active: true,
      status: "rr",
      courtIds: ["court1"],
      playoffThirdPlace: "bronze",
      playoffSeedOrder: ["team1", "team2"],
      pools: [{ id: "poolA", name: "Pool A", advance: 2, teams: [] }],
    }],
    matches: [{
      id: "match1",
      catId: "cat1",
      poolId: "poolA",
      stage: "RR",
      status: "queued",
      teamAId: "team1",
      teamBId: "team2",
      prepareCourtId: "court1",
      bracketY: 0.65,
    }],
  };

  assert.equal(validateTournamentState(state), null);
});
