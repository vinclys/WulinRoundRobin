export function validateTournamentState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return "state must be a JSON object";
  }
  if (!state.settings || typeof state.settings !== "object" || Array.isArray(state.settings)) {
    return "state.settings must be an object";
  }
  if (!Array.isArray(state.categories)) return "state.categories must be an array";
  if (!Array.isArray(state.matches)) return "state.matches must be an array";
  if (!Array.isArray(state.settings.courts)) return "state.settings.courts must be an array";
  if (state.settings.courts.length < 1 || state.settings.courts.length > 24) {
    return "court count must be between 1 and 24";
  }
  if (state.categories.length > 100) return "too many categories";
  if (state.matches.length > 20_000) return "too many matches";
  return null;
}
