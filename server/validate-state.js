export function validateTournamentState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return "state must be a JSON object";
  }
  if (state.version !== undefined && (!Number.isInteger(Number(state.version)) || Number(state.version) < 1 || Number(state.version) > 100)) {
    return "state.version must be an integer between 1 and 100";
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
    if (!court || typeof court !== "object" || Array.isArray(court)) return "each court must be an object";
    if (court.poolAccess !== undefined) {
      if (!court.poolAccess || typeof court.poolAccess !== "object" || Array.isArray(court.poolAccess)) {
        return "court.poolAccess must be an object";
      }
      for (const poolIds of Object.values(court.poolAccess)) {
        if (!Array.isArray(poolIds) || poolIds.some((poolId) => typeof poolId !== "string")) {
          return "court.poolAccess values must be arrays of pool IDs";
        }
      }
    }
  }

  for (const category of state.categories) {
    if (!category || typeof category !== "object" || Array.isArray(category)) return "each category must be an object";
    if (category.playoffSeedOrder !== undefined) {
      if (!Array.isArray(category.playoffSeedOrder) || category.playoffSeedOrder.some((teamId) => typeof teamId !== "string")) {
        return "category.playoffSeedOrder must be an array of team IDs";
      }
    }
  }

  for (const match of state.matches) {
    if (!match || typeof match !== "object" || Array.isArray(match)) return "each match must be an object";
    if (match.prepareCourtId !== undefined && typeof match.prepareCourtId !== "string") {
      return "match.prepareCourtId must be a string";
    }
    if (match.bracketY !== undefined && !Number.isFinite(Number(match.bracketY))) {
      return "match.bracketY must be numeric";
    }
  }
  return null;
}
