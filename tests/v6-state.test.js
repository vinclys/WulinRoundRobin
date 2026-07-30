import test from "node:test";
import assert from "node:assert/strict";
import { validateTournamentState } from "../server/validate-state.js";

test("v6 active-cat and compact-court state is accepted", () => {
  const state = {
    version: 6,
    settings: {
      eventName: "Wulin Annual Tournament",
      autoNext: true,
      prepareLimit: 6,
      dashboardCatIds: ["cat1"],
      prepareMatchIds: [],
      courts: Array.from({ length: 6 }, (_, index) => ({
        id: `court${index + 1}`,
        name: `Court ${index + 1}`,
        allowAllActive: index === 2,
      })),
    },
    categories: [{
      id: "cat1",
      name: "Mixed Doubles 4.0+",
      active: true,
      status: "rr",
      courtIds: ["court1", "court3"],
      playoffThirdPlace: "margin",
      pools: [],
    }],
    matches: [],
  };

  assert.equal(validateTournamentState(state), null);
});
