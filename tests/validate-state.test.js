import test from "node:test";
import assert from "node:assert/strict";
import { validateTournamentState } from "../server/validate-state.js";

const validState = {
  version: 4,
  settings: {
    eventName: "Test",
    courts: [{ id: "court1", name: "Court 1" }],
    dashboardCatIds: [],
    prepareMatchIds: [],
  },
  categories: [],
  matches: [],
};

test("valid tournament state passes validation", () => {
  assert.equal(validateTournamentState(validState), null);
});

test("invalid tournament state is rejected", () => {
  assert.match(validateTournamentState({ settings: {}, categories: [], matches: [] }), /courts/);
  assert.match(validateTournamentState({ ...validState, matches: null }), /matches/);
});
