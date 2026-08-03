import test from "node:test";
import assert from "node:assert/strict";
import { validateTournamentState } from "../server/validate-state.js";

test("v7 Cat/Pool court routes and preferred On Deck courts are accepted", () => {
  const state = {
    version: 7,
    settings: {
      eventName: "Wulin Annual Tournament",
      autoNext: true,
      prepareLimit: 6,
      dashboardCatIds: ["cat1"],
      prepareMatchIds: ["m1"],
      courts: Array.from({ length: 6 }, (_, index) => ({
        id: `court${index + 1}`,
        name: `Court ${index + 1}`,
        allowAllActive: false,
        poolAccess: index === 3 ? { cat1: ["poolA"] } : {},
      })),
    },
    categories: [{
      id: "cat1",
      name: "Men's Doubles 4.0+",
      active: true,
      status: "rr",
      courtIds: ["court4"],
      playoffThirdPlace: "margin",
      pools: [
        { id: "poolA", name: "Pool A", advance: 2, teams: [] },
        { id: "poolB", name: "Pool B", advance: 2, teams: [] },
      ],
    }],
    matches: [{
      id: "m1",
      catId: "cat1",
      poolId: "poolA",
      stage: "RR",
      status: "queued",
      preferredCourtId: "court4",
    }],
  };

  assert.equal(validateTournamentState(state), null);
});
