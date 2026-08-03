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

  for (const court of state.settings.courts) {
    if (!court || typeof court !== "object" || Array.isArray(court)) {
      return "every court must be an object";
    }
    if (typeof court.id !== "string" || !court.id.trim()) return "every court must have an id";
    if (court.poolAccess !== undefined) {
      if (!court.poolAccess || typeof court.poolAccess !== "object" || Array.isArray(court.poolAccess)) {
        return "court.poolAccess must be an object";
      }
      for (const poolIds of Object.values(court.poolAccess)) {
        if (!Array.isArray(poolIds) || poolIds.length > 100 || poolIds.some((value) => typeof value !== "string")) {
          return "court.poolAccess entries must be arrays of pool ids";
        }
      }
    }
  }

  for (const match of state.matches) {
    if (!match || typeof match !== "object" || Array.isArray(match)) return "every match must be an object";
    if (match.preferredCourtId !== undefined && typeof match.preferredCourtId !== "string") {
      return "match.preferredCourtId must be a string";
    }
  }

  return null;
}
