/**
 * Pure tournament helpers shared by the browser app and Node tests.
 */

function numericScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function completedMatchesForTeams(matches, teamIds) {
  return (matches || []).filter((match) => {
    if (!match || match.status !== "done") return false;
    const scoreA = numericScore(match.scoreA);
    const scoreB = numericScore(match.scoreB);
    return (
      scoreA !== null &&
      scoreB !== null &&
      teamIds.has(match.teamAId) &&
      teamIds.has(match.teamBId)
    );
  });
}

function addMatchToRows(match, byTeam, pointsForWin = 2) {
  const a = byTeam.get(match.teamAId);
  const b = byTeam.get(match.teamBId);
  if (!a || !b) return;
  const scoreA = Number(match.scoreA);
  const scoreB = Number(match.scoreB);

  a.played += 1;
  b.played += 1;
  a.for += scoreA;
  a.against += scoreB;
  b.for += scoreB;
  b.against += scoreA;

  if (scoreA > scoreB) {
    a.wins += 1;
    b.losses += 1;
    a.points += pointsForWin;
  } else if (scoreB > scoreA) {
    b.wins += 1;
    a.losses += 1;
    b.points += pointsForWin;
  }
}

function buildMiniTable(group, completed) {
  const ids = new Set(group.map((row) => row.teamId));
  const miniRows = group.map((row) => ({
    teamId: row.teamId,
    played: 0,
    wins: 0,
    losses: 0,
    points: 0,
    for: 0,
    against: 0,
    diff: 0,
  }));
  const byTeam = new Map(miniRows.map((row) => [row.teamId, row]));
  const headMatches = completed.filter(
    (match) => ids.has(match.teamAId) && ids.has(match.teamBId),
  );
  headMatches.forEach((match) => addMatchToRows(match, byTeam));
  miniRows.forEach((row) => {
    row.diff = row.for - row.against;
  });
  return { headMatches, byTeam };
}

function directScoreDetail(headMatches, winnerId, loserId) {
  if (headMatches.length === 1) {
    const match = headMatches[0];
    const winnerScore = match.teamAId === winnerId ? Number(match.scoreA) : Number(match.scoreB);
    const loserScore = match.teamAId === loserId ? Number(match.scoreA) : Number(match.scoreB);
    return `${winnerScore}-${loserScore}`;
  }

  let winnerFor = 0;
  let loserFor = 0;
  headMatches.forEach((match) => {
    if (match.teamAId === winnerId) {
      winnerFor += Number(match.scoreA);
      loserFor += Number(match.scoreB);
    } else if (match.teamBId === winnerId) {
      winnerFor += Number(match.scoreB);
      loserFor += Number(match.scoreA);
    }
  });
  return `${winnerFor}-${loserFor} aggregate`;
}

/**
 * Calculates Round Robin standings.
 *
 * Tie-break order:
 * 1. Win points
 * 2. Head-to-head (direct match for a two-team tie; mini-table for 3+ teams)
 * 3. Overall point differential
 * 4. Overall points for
 * 5. Team name
 */
export function calculateStandings(teams, matches, locale = "en") {
  const rows = (teams || []).map((team) => ({
    teamId: team.id,
    name: team.name,
    played: 0,
    wins: 0,
    losses: 0,
    points: 0,
    for: 0,
    against: 0,
    diff: 0,
    tieBreakLabel: "",
    tieBreakDetail: "",
  }));
  const byTeam = new Map(rows.map((row) => [row.teamId, row]));
  const completed = completedMatchesForTeams(matches, new Set(byTeam.keys()));

  completed.forEach((match) => addMatchToRows(match, byTeam));
  rows.forEach((row) => {
    row.diff = row.for - row.against;
  });

  const groups = new Map();
  rows.forEach((row) => {
    if (!groups.has(row.points)) groups.set(row.points, []);
    groups.get(row.points).push(row);
  });

  const output = [];
  Array.from(groups.keys())
    .sort((a, b) => b - a)
    .forEach((pointValue) => {
      const group = groups.get(pointValue);
      const mini = buildMiniTable(group, completed);

      if (group.length === 2 && mini.headMatches.length) {
        const [first, second] = group;
        const firstMini = mini.byTeam.get(first.teamId);
        const secondMini = mini.byTeam.get(second.teamId);
        const directCompare =
          secondMini.points - firstMini.points ||
          secondMini.wins - firstMini.wins ||
          secondMini.diff - firstMini.diff ||
          secondMini.for - firstMini.for;

        if (directCompare !== 0) {
          const winner = directCompare < 0 ? first : second;
          const loser = winner === first ? second : first;
          winner.tieBreakLabel = "H2H WIN";
          loser.tieBreakLabel = "H2H LOSS";
          const detail = directScoreDetail(mini.headMatches, winner.teamId, loser.teamId);
          winner.tieBreakDetail = detail;
          loser.tieBreakDetail = detail;
        }

        group.sort((a, b) => {
          const aMini = mini.byTeam.get(a.teamId);
          const bMini = mini.byTeam.get(b.teamId);
          return (
            bMini.points - aMini.points ||
            bMini.wins - aMini.wins ||
            bMini.diff - aMini.diff ||
            bMini.for - aMini.for ||
            b.diff - a.diff ||
            b.for - a.for ||
            String(a.name || "").localeCompare(String(b.name || ""), locale)
          );
        });
      } else if (group.length > 2 && mini.headMatches.length) {
        group.forEach((row) => {
          const miniRow = mini.byTeam.get(row.teamId);
          row.tieBreakLabel = "H2H MINI";
          row.tieBreakDetail = `${miniRow.points} pts · ${miniRow.diff >= 0 ? "+" : ""}${miniRow.diff}`;
        });
        group.sort((a, b) => {
          const aMini = mini.byTeam.get(a.teamId);
          const bMini = mini.byTeam.get(b.teamId);
          return (
            bMini.points - aMini.points ||
            bMini.wins - aMini.wins ||
            bMini.diff - aMini.diff ||
            bMini.for - aMini.for ||
            b.diff - a.diff ||
            b.for - a.for ||
            String(a.name || "").localeCompare(String(b.name || ""), locale)
          );
        });
      } else {
        group.sort(
          (a, b) =>
            b.diff - a.diff ||
            b.for - a.for ||
            b.wins - a.wins ||
            String(a.name || "").localeCompare(String(b.name || ""), locale),
        );
      }

      output.push(...group);
    });

  return output;
}

function seedOrder(pools, qualifiers) {
  const poolIndex = new Map((pools || []).map((pool, index) => [pool.id, index]));
  const byPool = new Map();
  (qualifiers || []).forEach((qualifier) => {
    if (!byPool.has(qualifier.poolId)) byPool.set(qualifier.poolId, []);
    byPool.get(qualifier.poolId).push(qualifier);
  });
  for (const list of byPool.values()) {
    list.sort(
      (a, b) =>
        a.rank - b.rank ||
        b.points - a.points ||
        b.diff - a.diff ||
        b.scored - a.scored,
    );
  }

  const ordered = [];
  const maxRank = Math.max(
    0,
    ...(qualifiers || []).map((qualifier) => Number(qualifier.rank || 0)),
  );
  for (let rank = 1; rank <= maxRank; rank += 1) {
    const poolList = rank % 2 === 1 ? pools || [] : (pools || []).slice().reverse();
    poolList.forEach((pool) => {
      const qualifier = (byPool.get(pool.id) || []).find((item) => item.rank === rank);
      if (qualifier) ordered.push(qualifier);
    });
  }

  (qualifiers || [])
    .filter((qualifier) => !ordered.some((item) => item.teamId === qualifier.teamId))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (poolIndex.get(a.poolId) ?? 999) - (poolIndex.get(b.poolId) ?? 999),
    )
    .forEach((qualifier) => ordered.push(qualifier));
  return ordered;
}

function conflictCount(pairs) {
  return pairs.reduce((count, pair) => {
    const [a, b] = pair;
    if (!a || !b || a.teamId === "BYE" || b.teamId === "BYE") return count;
    return count + (a.poolId && a.poolId === b.poolId ? 1 : 0);
  }, 0);
}

function optimizeOpponentSwaps(pairs) {
  let improved = true;
  while (improved) {
    improved = false;
    const beforeTotal = conflictCount(pairs);
    for (let i = 0; i < pairs.length && !improved; i += 1) {
      for (let j = i + 1; j < pairs.length; j += 1) {
        const beforeI = pairs[i][1];
        const beforeJ = pairs[j][1];
        pairs[i][1] = beforeJ;
        pairs[j][1] = beforeI;
        const afterTotal = conflictCount(pairs);
        if (afterTotal < beforeTotal) {
          improved = true;
          break;
        }
        pairs[i][1] = beforeI;
        pairs[j][1] = beforeJ;
      }
    }
  }
  return pairs;
}

/**
 * Produces opening-round bracket pairs.
 *
 * The common two-pool / top-two format is explicit:
 *   Pool A #1 v Pool B #2
 *   Pool A #2 v Pool B #1
 */
export function buildFirstRoundPairs(pools, qualifiers, bracketSize) {
  const activePools = (pools || []).filter((pool) =>
    (qualifiers || []).some((qualifier) => qualifier.poolId === pool.id),
  );
  const byPool = new Map(
    activePools.map((pool) => [
      pool.id,
      (qualifiers || [])
        .filter((qualifier) => qualifier.poolId === pool.id)
        .sort(
          (a, b) =>
            a.rank - b.rank ||
            b.points - a.points ||
            b.diff - a.diff ||
            b.scored - a.scored,
        ),
    ]),
  );

  if (
    activePools.length === 2 &&
    (qualifiers || []).length === 4 &&
    (byPool.get(activePools[0].id) || []).length === 2 &&
    (byPool.get(activePools[1].id) || []).length === 2
  ) {
    const poolA = byPool.get(activePools[0].id);
    const poolB = byPool.get(activePools[1].id);
    return [
      [poolA[0], poolB[1]],
      [poolA[1], poolB[0]],
    ];
  }

  const ordered = seedOrder(pools, qualifiers);
  const size = Math.max(2, Number(bracketSize || 0));
  const slots = ordered.slice(0, size);
  while (slots.length < size) {
    slots.push({
      teamId: "BYE",
      name: "BYE",
      poolId: "",
      poolName: "",
      rank: 999,
      points: -1,
      diff: -9999,
      scored: -1,
    });
  }

  const pairs = [];
  for (let index = 0; index < size / 2; index += 1) {
    pairs.push([slots[index], slots[size - 1 - index]]);
  }
  return optimizeOpponentSwaps(pairs);
}
