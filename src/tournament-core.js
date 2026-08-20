/**
 * Pure tournament rules shared by the browser app and automated tests.
 * Keeping these functions DOM-free makes the two highest-risk rules
 * (standings tie-breaks and playoff seeding) independently testable.
 */

function compareFallback(a, b) {
  return (
    Number(b.diff || 0) - Number(a.diff || 0) ||
    Number(b.for || 0) - Number(a.for || 0) ||
    String(a.name || "").localeCompare(String(b.name || ""), "en")
  );
}

/**
 * Rank one Round Robin pool.
 * Rule order:
 * 1. Win points
 * 2. Head-to-head result for a two-team tie
 * 3. Head-to-head mini table for a tie of three or more teams
 * 4. Overall point differential
 * 5. Overall points scored
 * 6. Team name, for deterministic display only
 */
export function computePoolStandings(teams, completedMatches, options = {}) {
  const winPoints = Number.isFinite(Number(options.winPoints)) ? Number(options.winPoints) : 2;
  const safeTeams = Array.isArray(teams) ? teams : [];
  const safeMatches = Array.isArray(completedMatches) ? completedMatches : [];

  const rows = safeTeams.map((team) => ({
    teamId: team.id,
    name: team.name || "Unnamed Team",
    played: 0,
    wins: 0,
    losses: 0,
    points: 0,
    for: 0,
    against: 0,
    diff: 0,
    h2hPoints: 0,
    tieBreakNote: "",
  }));
  const byTeam = new Map(rows.map((row) => [row.teamId, row]));

  const completed = safeMatches.filter((match) => {
    const scoreA = Number(match.scoreA);
    const scoreB = Number(match.scoreB);
    return (
      match &&
      match.status === "done" &&
      byTeam.has(match.teamAId) &&
      byTeam.has(match.teamBId) &&
      Number.isFinite(scoreA) &&
      Number.isFinite(scoreB) &&
      scoreA !== scoreB
    );
  });

  completed.forEach((match) => {
    const rowA = byTeam.get(match.teamAId);
    const rowB = byTeam.get(match.teamBId);
    const scoreA = Number(match.scoreA);
    const scoreB = Number(match.scoreB);

    rowA.played += 1;
    rowB.played += 1;
    rowA.for += scoreA;
    rowA.against += scoreB;
    rowB.for += scoreB;
    rowB.against += scoreA;

    if (scoreA > scoreB) {
      rowA.wins += 1;
      rowB.losses += 1;
      rowA.points += winPoints;
    } else {
      rowB.wins += 1;
      rowA.losses += 1;
      rowB.points += winPoints;
    }
  });

  rows.forEach((row) => {
    row.diff = row.for - row.against;
  });

  const pointsGroups = new Map();
  rows.forEach((row) => {
    if (!pointsGroups.has(row.points)) pointsGroups.set(row.points, []);
    pointsGroups.get(row.points).push(row);
  });

  const ranked = [];
  Array.from(pointsGroups.keys())
    .sort((a, b) => b - a)
    .forEach((points) => {
      const tied = pointsGroups.get(points);

      if (tied.length === 1) {
        ranked.push(tied[0]);
        return;
      }

      if (tied.length === 2) {
        const [first, second] = tied;
        const directMatch = completed.find(
          (match) =>
            (match.teamAId === first.teamId && match.teamBId === second.teamId) ||
            (match.teamAId === second.teamId && match.teamBId === first.teamId),
        );

        if (directMatch) {
          const scoreA = Number(directMatch.scoreA);
          const scoreB = Number(directMatch.scoreB);
          const winnerId = scoreA > scoreB ? directMatch.teamAId : directMatch.teamBId;
          const scoreByTeam = new Map([
            [directMatch.teamAId, `${scoreA}-${scoreB}`],
            [directMatch.teamBId, `${scoreB}-${scoreA}`],
          ]);

          tied.forEach((row) => {
            const won = row.teamId === winnerId;
            row.h2hPoints = won ? winPoints : 0;
            row.tieBreakNote = `${won ? "H2H W" : "H2H L"} ${scoreByTeam.get(row.teamId)}`;
          });
          tied.sort((a, b) => {
            if (a.teamId === winnerId && b.teamId !== winnerId) return -1;
            if (b.teamId === winnerId && a.teamId !== winnerId) return 1;
            return compareFallback(a, b);
          });
        } else {
          tied.forEach((row) => {
            row.tieBreakNote = "H2H pending";
          });
          tied.sort(compareFallback);
        }

        ranked.push(...tied);
        return;
      }

      // A circular tie cannot be solved by one direct game. Build a mini table
      // using only games among the tied teams, then fall back to overall DIFF/PF.
      const tiedIds = new Set(tied.map((row) => row.teamId));
      const miniPoints = new Map(tied.map((row) => [row.teamId, 0]));
      completed.forEach((match) => {
        if (!tiedIds.has(match.teamAId) || !tiedIds.has(match.teamBId)) return;
        const scoreA = Number(match.scoreA);
        const scoreB = Number(match.scoreB);
        const winnerId = scoreA > scoreB ? match.teamAId : match.teamBId;
        miniPoints.set(winnerId, (miniPoints.get(winnerId) || 0) + winPoints);
      });

      tied.forEach((row) => {
        row.h2hPoints = miniPoints.get(row.teamId) || 0;
        row.tieBreakNote = `H2H ${row.h2hPoints}`;
      });
      tied.sort((a, b) => b.h2hPoints - a.h2hPoints || compareFallback(a, b));
      ranked.push(...tied);
    });

  return ranked;
}

function seedQualifiers(pools, qualifiers) {
  const byPool = new Map();
  qualifiers.forEach((qualifier) => {
    if (!byPool.has(qualifier.poolId)) byPool.set(qualifier.poolId, []);
    byPool.get(qualifier.poolId).push(qualifier);
  });
  for (const list of byPool.values()) {
    list.sort(
      (a, b) =>
        Number(a.rank || 0) - Number(b.rank || 0) ||
        Number(b.points || 0) - Number(a.points || 0) ||
        Number(b.diff || 0) - Number(a.diff || 0) ||
        Number(b.scored || 0) - Number(a.scored || 0),
    );
  }

  const ordered = [];
  const maxRank = Math.max(0, ...qualifiers.map((qualifier) => Number(qualifier.rank || 0)));
  for (let rank = 1; rank <= maxRank; rank += 1) {
    const poolOrder = rank % 2 === 1 ? pools : pools.slice().reverse();
    poolOrder.forEach((pool) => {
      const qualifier = (byPool.get(pool.id) || []).find((entry) => Number(entry.rank) === rank);
      if (qualifier) ordered.push(qualifier);
    });
  }
  return ordered;
}

function fixSamePoolFirstRound(pairs) {
  for (let index = 0; index < pairs.length; index += 1) {
    const [left, right] = pairs[index];
    if (!left || !right || left.teamId === "BYE" || right.teamId === "BYE") continue;
    if (!left.poolId || left.poolId !== right.poolId) continue;

    for (let swapIndex = pairs.length - 1; swapIndex >= 0; swapIndex -= 1) {
      if (index === swapIndex) continue;
      const candidate = pairs[swapIndex][1];
      const candidateOpponent = pairs[swapIndex][0];
      if (!candidate || candidate.teamId === "BYE") continue;
      if (candidate.poolId !== left.poolId && candidate.poolId !== candidateOpponent?.poolId) {
        pairs[swapIndex][1] = right;
        pairs[index][1] = candidate;
        break;
      }
    }
  }
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function qualifierFallbackCompare(a, b, poolOrder = new Map()) {
  return (
    Number(b.diff || 0) - Number(a.diff || 0) ||
    Number(b.scored || 0) - Number(a.scored || 0) ||
    Number(poolOrder.get(a.poolId) ?? 9999) - Number(poolOrder.get(b.poolId) ?? 9999) ||
    Number(a.rank || 9999) - Number(b.rank || 9999) ||
    String(a.name || "").localeCompare(String(b.name || ""), "en")
  );
}

/**
 * Rank qualifiers from different Round Robin pools.
 *
 * Rule order requested for the tournament:
 * 1. Win points
 * 2. Head-to-head when the tied teams actually met in the same pool
 * 3. Point differential
 * 4. Points for
 *
 * Cross-pool teams have no direct head-to-head result. To keep the ordering
 * deterministic and transitive, each equal-points group is treated as a small
 * partial-order problem: same-pool H2H order becomes a hard precedence edge,
 * while teams that never met are selected by DIFF, PF and stable fallbacks.
 */
export function rankCrossPoolQualifiers(pools, qualifiers, manualOrder = []) {
  const safePools = Array.isArray(pools) ? pools : [];
  const safeQualifiers = Array.isArray(qualifiers) ? qualifiers.slice() : [];
  const poolOrder = new Map(safePools.map((pool, index) => [pool.id, index]));

  const autoOrdered = [];
  const byPoints = new Map();
  safeQualifiers.forEach((qualifier) => {
    const points = Number(qualifier.points || 0);
    if (!byPoints.has(points)) byPoints.set(points, []);
    byPoints.get(points).push(qualifier);
  });

  Array.from(byPoints.keys())
    .sort((a, b) => b - a)
    .forEach((points) => {
      const group = byPoints.get(points).slice();
      const byId = new Map(group.map((entry) => [entry.teamId, entry]));
      const outgoing = new Map(group.map((entry) => [entry.teamId, new Set()]));
      const indegree = new Map(group.map((entry) => [entry.teamId, 0]));

      const byPool = new Map();
      group.forEach((entry) => {
        if (!byPool.has(entry.poolId)) byPool.set(entry.poolId, []);
        byPool.get(entry.poolId).push(entry);
      });

      // Pool standings already apply H2H before DIFF/PF. For equal-points
      // qualifiers from the same pool, preserve that order as the H2H edge.
      byPool.forEach((entries) => {
        entries.sort(
          (a, b) =>
            Number(a.rank || 9999) - Number(b.rank || 9999) ||
            Number(b.h2hPoints || 0) - Number(a.h2hPoints || 0) ||
            qualifierFallbackCompare(a, b, poolOrder),
        );
        for (let index = 0; index < entries.length - 1; index += 1) {
          const higher = entries[index];
          const lower = entries[index + 1];
          if (!outgoing.get(higher.teamId).has(lower.teamId)) {
            outgoing.get(higher.teamId).add(lower.teamId);
            indegree.set(lower.teamId, (indegree.get(lower.teamId) || 0) + 1);
          }
        }
      });

      const remaining = new Set(group.map((entry) => entry.teamId));
      while (remaining.size) {
        const available = Array.from(remaining)
          .filter((teamId) => (indegree.get(teamId) || 0) === 0)
          .map((teamId) => byId.get(teamId))
          .sort((a, b) => qualifierFallbackCompare(a, b, poolOrder));

        // Defensive fallback: a cycle should not be possible, but never leave
        // a tournament without a seed order if imported data is malformed.
        const next = available[0] || Array.from(remaining).map((id) => byId.get(id)).sort((a, b) => qualifierFallbackCompare(a, b, poolOrder))[0];
        autoOrdered.push(next);
        remaining.delete(next.teamId);
        (outgoing.get(next.teamId) || []).forEach((targetId) => {
          indegree.set(targetId, Math.max(0, (indegree.get(targetId) || 0) - 1));
        });
      }
    });

  const autoIds = autoOrdered.map((entry) => entry.teamId);
  const manualIds = Array.isArray(manualOrder) ? manualOrder.filter((id) => typeof id === "string") : [];
  const manualValid =
    manualIds.length === autoIds.length &&
    new Set(manualIds).size === autoIds.length &&
    manualIds.every((id) => autoIds.includes(id));

  const ordered = manualValid
    ? manualIds.map((teamId) => autoOrdered.find((entry) => entry.teamId === teamId))
    : autoOrdered;

  return { ordered, autoOrdered, manualApplied: manualValid };
}

/**
 * Build first-round playoff pairings.
 * Exact two-pool / top-two rule is intentionally explicit:
 * A1 v B2 and A2 v B1.
 */
export function buildPlayoffBracketPlan(pools, qualifiers, options = {}) {
  const safePools = Array.isArray(pools) ? pools : [];
  const safeQualifiers = Array.isArray(qualifiers) ? qualifiers : [];
  const byPool = new Map();

  safeQualifiers.forEach((qualifier) => {
    if (!byPool.has(qualifier.poolId)) byPool.set(qualifier.poolId, []);
    byPool.get(qualifier.poolId).push(qualifier);
  });
  byPool.forEach((list) =>
    list.sort(
      (a, b) =>
        Number(a.rank || 0) - Number(b.rank || 0) ||
        Number(b.points || 0) - Number(a.points || 0) ||
        Number(b.diff || 0) - Number(a.diff || 0) ||
        Number(b.scored || 0) - Number(a.scored || 0),
    ),
  );

  const participatingPools = safePools.filter((pool) => (byPool.get(pool.id) || []).length > 0);

  if (
    participatingPools.length === 3 &&
    safeQualifiers.length === 6 &&
    participatingPools.every((pool) => (byPool.get(pool.id) || []).length === 2)
  ) {
    const ranking = rankCrossPoolQualifiers(
      participatingPools,
      safeQualifiers,
      options.manualSeedOrder,
    );
    const ordered = ranking.ordered.map((entry, index) => ({
      ...entry,
      seedNumber: index + 1,
    }));
    return {
      bracketSize: 6,
      firstPairs: [
        [ordered[2], ordered[5]],
        [ordered[3], ordered[4]],
      ],
      ordered,
      autoOrdered: ranking.autoOrdered.map((entry, index) => ({
        ...entry,
        seedNumber: index + 1,
      })),
      manualApplied: ranking.manualApplied,
      strategy: "three-pool-six-seed",
    };
  }

  if (participatingPools.length === 2) {
    const poolA = byPool.get(participatingPools[0].id) || [];
    const poolB = byPool.get(participatingPools[1].id) || [];

    if (poolA.length === 2 && poolB.length === 2) {
      const firstPairs = [
        [poolA[0], poolB[1]],
        [poolA[1], poolB[0]],
      ];
      return {
        bracketSize: 4,
        firstPairs,
        ordered: [poolA[0], poolB[1], poolA[1], poolB[0]],
        strategy: "two-pool-crossover",
      };
    }

    if (poolA.length === 1 && poolB.length === 1) {
      return {
        bracketSize: 2,
        firstPairs: [[poolA[0], poolB[0]]],
        ordered: [poolA[0], poolB[0]],
        strategy: "two-pool-final",
      };
    }
  }

  const ordered = seedQualifiers(safePools, safeQualifiers);
  const bracketSize = nextPowerOfTwo(Math.max(2, ordered.length));
  const slots = ordered.slice();
  while (slots.length < bracketSize) {
    slots.push({ teamId: "BYE", name: "BYE", poolId: "", poolName: "", rank: 999 });
  }

  const firstPairs = [];
  for (let index = 0; index < bracketSize / 2; index += 1) {
    firstPairs.push([slots[index], slots[bracketSize - 1 - index]]);
  }
  fixSamePoolFirstRound(firstPairs);

  return {
    bracketSize,
    firstPairs,
    ordered,
    strategy: "flexible-seeding",
  };
}

/** Pure pool access predicate used by tests and the browser wrapper. */
export function isPoolAllowed(poolAccess, categoryId, poolId) {
  if (!poolId) return true;
  if (!poolAccess || typeof poolAccess !== "object" || Array.isArray(poolAccess)) return true;
  if (!Object.prototype.hasOwnProperty.call(poolAccess, categoryId)) return true;
  const selected = Array.isArray(poolAccess[categoryId]) ? poolAccess[categoryId] : [];
  return selected.includes(poolId);
}

function categoryHasCourtAccess(court, category) {
  if (!court || !category || !category.active) return false;
  const courtIds = Array.isArray(category.courtIds) ? category.courtIds : [];
  return Boolean(court.allowAllActive) || courtIds.includes(court.id);
}

function matchAllowedOnCourt(court, match, categoryById) {
  const category = categoryById.get(match.catId);
  if (!categoryHasCourtAccess(court, category)) return false;
  if (match.stage !== "RR" || !match.poolId) return true;
  return isPoolAllowed(court.poolAccess, match.catId, match.poolId);
}

function isReadyQueuedMatch(match) {
  return Boolean(
    match &&
      match.status === "queued" &&
      !match.hold &&
      match.teamAId &&
      match.teamBId &&
      match.teamAId !== "BYE" &&
      match.teamBId !== "BYE",
  );
}

/**
 * Select TV 1 On Deck entries from court rules.
 * Staff-selected matches are kept even when a participant is currently playing;
 * automatic selections never call a busy team and are chosen per court's
 * Category + Pool access.
 */
export function selectOnDeckEntries({
  matches,
  categories,
  courts,
  manualMatchIds,
  limit = 6,
}) {
  const safeMatches = Array.isArray(matches) ? matches : [];
  const safeCategories = Array.isArray(categories) ? categories : [];
  const safeCourts = Array.isArray(courts) ? courts : [];
  const categoryById = new Map(safeCategories.map((category) => [category.id, category]));
  const matchById = new Map(safeMatches.map((match) => [match.id, match]));
  const categoryOrder = new Map(safeCategories.map((category, index) => [category.id, index]));
  const manualIds = Array.isArray(manualMatchIds) ? manualMatchIds : [];
  const manualIdSet = new Set(manualIds);
  const requestedLimit = Math.max(3, Math.min(6, Number(limit || 6)));

  const busyTeams = new Set();
  safeMatches
    .filter((match) => match.status === "playing")
    .forEach((match) => {
      if (match.teamAId && match.teamAId !== "BYE") busyTeams.add(match.teamAId);
      if (match.teamBId && match.teamBId !== "BYE") busyTeams.add(match.teamBId);
    });

  const baseSort = (left, right) =>
    Number(left.sequence || 0) - Number(right.sequence || 0) ||
    Number(categoryOrder.get(left.catId) ?? 9999) - Number(categoryOrder.get(right.catId) ?? 9999) ||
    String(left.id || "").localeCompare(String(right.id || ""));

  const configuredCourts = (match) =>
    safeCourts.filter((court) => matchAllowedOnCourt(court, match, categoryById));

  const entries = [];
  const usedMatchIds = new Set();
  const reservedTeams = new Set();

  manualIds.forEach((matchId) => {
    if (entries.length >= requestedLimit) return;
    const match = matchById.get(matchId);
    const category = match ? categoryById.get(match.catId) : null;
    if (!match || !category?.active || !isReadyQueuedMatch(match) || usedMatchIds.has(match.id)) return;

    const allowedCourts = configuredCourts(match);
    const preferredCourt = allowedCourts.some((court) => court.id === match.prepareCourtId)
      ? match.prepareCourtId
      : allowedCourts[0]?.id || "";
    entries.push({
      match,
      courtId: preferredCourt,
      manual: true,
      teamsBusy: busyTeams.has(match.teamAId) || busyTeams.has(match.teamBId),
    });
    usedMatchIds.add(match.id);
    reservedTeams.add(match.teamAId);
    reservedTeams.add(match.teamBId);
  });

  const activeCourts = safeCourts.filter((court) =>
    safeCategories.some((category) => categoryHasCourtAccess(court, category)),
  );
  const courtPickCount = new Map(activeCourts.map((court) => [court.id, 0]));
  entries.forEach((entry) => {
    if (entry.courtId && courtPickCount.has(entry.courtId)) {
      courtPickCount.set(entry.courtId, (courtPickCount.get(entry.courtId) || 0) + 1);
    }
  });

  let progressed = true;
  while (entries.length < requestedLimit && progressed) {
    progressed = false;
    const orderedCourts = activeCourts.slice().sort(
      (left, right) =>
        (courtPickCount.get(left.id) || 0) - (courtPickCount.get(right.id) || 0) ||
        safeCourts.indexOf(left) - safeCourts.indexOf(right),
    );

    for (const court of orderedCourts) {
      if (entries.length >= requestedLimit) break;
      const candidates = safeMatches
        .filter((match) => isReadyQueuedMatch(match))
        .filter((match) => categoryById.get(match.catId)?.active)
        .filter((match) => !manualIdSet.has(match.id) && !usedMatchIds.has(match.id))
        .filter((match) => matchAllowedOnCourt(court, match, categoryById))
        .filter((match) => !busyTeams.has(match.teamAId) && !busyTeams.has(match.teamBId))
        .filter((match) => !reservedTeams.has(match.teamAId) && !reservedTeams.has(match.teamBId))
        .sort((left, right) => {
          const leftPreferred = left.prepareCourtId === court.id ? 0 : 1;
          const rightPreferred = right.prepareCourtId === court.id ? 0 : 1;
          return leftPreferred - rightPreferred || baseSort(left, right);
        });

      const match = candidates[0];
      if (!match) continue;
      entries.push({ match, courtId: court.id, manual: false, teamsBusy: false });
      usedMatchIds.add(match.id);
      reservedTeams.add(match.teamAId);
      reservedTeams.add(match.teamBId);
      courtPickCount.set(court.id, (courtPickCount.get(court.id) || 0) + 1);
      progressed = true;
    }
  }

  return entries;
}
