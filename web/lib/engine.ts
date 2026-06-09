// DraftLab recommendation engine — TypeScript port of recommend.py
// Pure functions, no I/O. Components fetch the JSON and pass it in.

// ---------- Types ----------

export type Role = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";

export type DamageType = "AD" | "AP" | "MIXED" | "NONE";

export interface ChampionMetaEntry {
  damage_type: DamageType;
  is_frontline: boolean;
  is_ranged: boolean;
}

// stats.json shape
export interface ChampionRoleStat {
  games: number;
  wins: number;
  winrate: number;
}

export interface MatchupStat {
  games: number;
  wins: number;
  winrate: number;
}

export interface SynergyStat {
  games: number;
  wins: number;
  winrate: number;
}

export interface Stats {
  // key format: "ChampionName|ROLE"
  champion_role_stats: Record<string, ChampionRoleStat>;
  // key format: "ChampA|ROLE_A|ChampB|ROLE_B"
  matchup_stats: Record<string, MatchupStat>;
  // key format: "ChampA|ChampB" (sorted alphabetically, same team)
  synergy_stats: Record<string, SynergyStat>;
}

export type ChampionMeta = Record<string, ChampionMetaEntry>;

// User's personal pool (from fetch_user_pool.py)
export interface UserPool {
  // key format: "ChampionName|ROLE" -> games played on that champ in that role
  [championRole: string]: number;
}

// A drafted slot — either filled or empty
export interface DraftSlot {
  role: Role;
  champion: string | null;
}

export interface Recommendation {
  champion: string;
  score: number;
  base_winrate: number;
  base_games: number;
  /** Fraction of all picks at this role that go to this champion. 0..1. */
  pick_rate: number;
  /** sqrt(pick_rate / META_PICKRATE_REFERENCE), clamped to 1. <1 = off-meta. */
  meta_factor: number;
  matchup_delta: number;
  synergy_delta: number;
  composition_delta: number;
  personal_bonus: number;
  breakdown: string[];
}

/** A signed delta plus the total games backing it (sum of per-stat sample sizes). */
export interface WeightedDelta {
  value: number;
  games: number;
}

export interface MatchupEvaluation {
  blue_winrate: number;
  red_winrate: number;
  blue_edge: number;
  blue_filled: number;
  red_filled: number;
  breakdown: {
    base: WeightedDelta;
    matchups: WeightedDelta;
    synergies: WeightedDelta;
    /** Composition is rule-based, no sample size — games is always 0 here. */
    composition: WeightedDelta;
  };
}

// ---------- Constants ----------

const ROLES: Role[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

const SHRINKAGE_REFERENCE_GAMES = 1000;
const MIN_BASE_GAMES = 30;
const MIN_MATCHUP_GAMES = 20; // in-lane (same role) matchups
const MIN_CROSS_ROLE_MATCHUP_GAMES = 40; // out-of-lane matchups need more games
const MIN_SYNERGY_GAMES = 20;

/**
 * Cross-role matchup weights. Same-role pairings always get 1.0 — they're
 * the direct lane matchup. Cross-role weights reflect how much those
 * positions actually interact: jungle ganks everywhere (high), bot/sup
 * share a lane (high), top vs distant lanes (low).
 * Keys are sorted alphabetically so the lookup is symmetric.
 */
const ROLE_INTERACTION_WEIGHTS: Record<string, number> = {
  "BOTTOM|UTILITY": 0.7,
  "JUNGLE|TOP": 0.5,
  "JUNGLE|MIDDLE": 0.5,
  "BOTTOM|JUNGLE": 0.5,
  "JUNGLE|UTILITY": 0.5,
  "MIDDLE|TOP": 0.3,
  "BOTTOM|MIDDLE": 0.3,
  "MIDDLE|UTILITY": 0.3,
  "BOTTOM|TOP": 0.2,
  "TOP|UTILITY": 0.2,
};

function roleInteractionWeight(roleA: Role, roleB: Role): number {
  if (roleA === roleB) return 1.0;
  const key =
    roleA < roleB ? `${roleA}|${roleB}` : `${roleB}|${roleA}`;
  return ROLE_INTERACTION_WEIGHTS[key] ?? 0.3;
}

/**
 * Pick-rate threshold below which we treat a (champion, role) as off-meta
 * and shrink its base contribution. A 0.5% pick rate means that role-slot
 * draws this champion roughly 1 game in 200 — anyone below that is almost
 * certainly a one-trick whose winrate is selection-biased.
 *
 * Same sqrt(p / ref) shape we use for sample-size shrinkage.
 */
const META_PICKRATE_REFERENCE = 0.005;
const OFF_META_BADGE_THRESHOLD = 0.7; // factor < this → flag in the UI

// Composition penalty weights (winrate-point deltas)
const COMP_NO_FRONTLINE_PENALTY = -0.04;
const COMP_DAMAGE_IMBALANCE_PENALTY = -0.02;
const COMP_ALL_MELEE_PENALTY = -0.015;

// Personalization weight — how much your champion pool nudges the score
const PERSONAL_POOL_WEIGHT = 0.5;

// ---------- Helpers ----------

export function shrunkDelta(rawWinrate: number, games: number): number {
  const delta = rawWinrate - 0.5;
  const confidence = Math.min(1, Math.sqrt(games / SHRINKAGE_REFERENCE_GAMES));
  return delta * confidence;
}

function key2(a: string, b: string): string {
  return `${a}|${b}`;
}

function key4(champA: string, roleA: Role, champB: string, roleB: Role): string {
  return `${champA}|${roleA}|${champB}|${roleB}`;
}

function synergyKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Total games seen at each role across all champions. Computed once per
 * Stats reference and memoized via WeakMap — the engine is pure but stats
 * objects are stable across renders, so this is essentially free.
 */
const roleTotalsCache = new WeakMap<Stats, Record<Role, number>>();
function roleTotals(stats: Stats): Record<Role, number> {
  const cached = roleTotalsCache.get(stats);
  if (cached) return cached;
  const totals: Record<Role, number> = {
    TOP: 0, JUNGLE: 0, MIDDLE: 0, BOTTOM: 0, UTILITY: 0,
  };
  for (const [key, stat] of Object.entries(stats.champion_role_stats)) {
    const [, role] = key.split("|") as [string, Role];
    if (role in totals) totals[role as Role] += stat.games;
  }
  roleTotalsCache.set(stats, totals);
  return totals;
}

/**
 * Selection-bias-aware shrinkage. Off-meta picks (Ashe jungle, Yuumi mid)
 * have winrates that look high because only one-tricks pick them — so we
 * trust them less for a random player. Returns a multiplier in [0, 1].
 */
export function metaFactor(games: number, roleTotal: number): number {
  if (roleTotal <= 0 || games <= 0) return 1;
  const pickRate = games / roleTotal;
  return Math.min(1, Math.sqrt(pickRate / META_PICKRATE_REFERENCE));
}

// ---------- Composition scoring ----------

export function compositionScore(team: string[], championMeta: ChampionMeta): number {
  const filled = team.filter((c) => c !== null && c !== "");
  if (filled.length < 3) return 0;

  let score = 0;

  const hasFrontline = filled.some((c) => championMeta[c]?.is_frontline);
  if (!hasFrontline) {
    score += COMP_NO_FRONTLINE_PENALTY;
  }

  const damageTypes = filled
    .map((c) => championMeta[c]?.damage_type)
    .filter((t) => t === "AD" || t === "AP");
  if (damageTypes.length >= 3) {
    const adCount = damageTypes.filter((t) => t === "AD").length;
    const apCount = damageTypes.filter((t) => t === "AP").length;
    if (adCount === 0 || apCount === 0) {
      score += COMP_DAMAGE_IMBALANCE_PENALTY;
    }
  }

  const ranged = filled.filter((c) => championMeta[c]?.is_ranged);
  if (filled.length >= 4 && ranged.length === 0) {
    score += COMP_ALL_MELEE_PENALTY;
  }

  return score;
}

// ---------- Matchup evaluation (blue vs red) ----------

export function evaluateMatchup(
  stats: Stats,
  championMeta: ChampionMeta,
  blueTeam: DraftSlot[],
  redTeam: DraftSlot[]
): MatchupEvaluation {
  let blueEdge = 0;
  const breakdown = {
    base: { value: 0, games: 0 },
    matchups: { value: 0, games: 0 },
    synergies: { value: 0, games: 0 },
    composition: { value: 0, games: 0 },
  };

  const blueFilled = blueTeam.filter((s) => s.champion);
  const redFilled = redTeam.filter((s) => s.champion);

  const totals = roleTotals(stats);

  for (const slot of blueFilled) {
    if (!slot.champion) continue;
    const stat = stats.champion_role_stats[key2(slot.champion, slot.role)];
    if (stat && stat.games >= MIN_BASE_GAMES) {
      const factor = metaFactor(stat.games, totals[slot.role]);
      const d = shrunkDelta(stat.winrate, stat.games) * factor;
      blueEdge += d;
      breakdown.base.value += d;
      breakdown.base.games += stat.games;
    }
  }

  for (const slot of redFilled) {
    if (!slot.champion) continue;
    const stat = stats.champion_role_stats[key2(slot.champion, slot.role)];
    if (stat && stat.games >= MIN_BASE_GAMES) {
      const factor = metaFactor(stat.games, totals[slot.role]);
      const d = shrunkDelta(stat.winrate, stat.games) * factor;
      blueEdge -= d;
      breakdown.base.value -= d;
      breakdown.base.games += stat.games;
    }
  }

  // Matchups: every cross-team pair, in-lane + cross-role
  for (const blueSlot of blueFilled) {
    if (!blueSlot.champion) continue;
    for (const redSlot of redFilled) {
      if (!redSlot.champion) continue;
      const stat =
        stats.matchup_stats[
          key4(blueSlot.champion, blueSlot.role, redSlot.champion, redSlot.role)
        ];
      if (!stat) continue;
      const sameRole = blueSlot.role === redSlot.role;
      const minGames = sameRole ? MIN_MATCHUP_GAMES : MIN_CROSS_ROLE_MATCHUP_GAMES;
      if (stat.games < minGames) continue;
      const weight = roleInteractionWeight(blueSlot.role, redSlot.role);
      // Off-meta dampening: each champion contributes scaled by how much it
      // belongs in its role. Yuumi top doesn't get full Yuumi-synergies credit.
      const blueChampBaseGames =
        stats.champion_role_stats[key2(blueSlot.champion!, blueSlot.role)]?.games ?? 0;
      const redChampBaseGames =
        stats.champion_role_stats[key2(redSlot.champion!, redSlot.role)]?.games ?? 0;
      const blueMeta = metaFactor(blueChampBaseGames, totals[blueSlot.role]);
      const redMeta = metaFactor(redChampBaseGames, totals[redSlot.role]);
      const pairMeta = Math.min(blueMeta, redMeta); // weakest link wins
      const matchupDelta = shrunkDelta(stat.winrate, stat.games) * weight * pairMeta;
      blueEdge += matchupDelta;
      breakdown.matchups.value += matchupDelta;
      breakdown.matchups.games += stat.games;
    }
  }

  for (let i = 0; i < blueFilled.length; i++) {
    for (let j = i + 1; j < blueFilled.length; j++) {
      const a = blueFilled[i].champion!;
      const b = blueFilled[j].champion!;
      const stat = stats.synergy_stats[synergyKey(a, b)];
      if (stat && stat.games >= MIN_SYNERGY_GAMES) {
        const aGames =
          stats.champion_role_stats[key2(a, blueFilled[i].role)]?.games ?? 0;
        const bGames =
          stats.champion_role_stats[key2(b, blueFilled[j].role)]?.games ?? 0;
        const pairMeta = Math.min(
          metaFactor(aGames, totals[blueFilled[i].role]),
          metaFactor(bGames, totals[blueFilled[j].role])
        );
        const syn = shrunkDelta(stat.winrate, stat.games) * pairMeta;
        blueEdge += syn;
        breakdown.synergies.value += syn;
        breakdown.synergies.games += stat.games;
      }
    }
  }
  for (let i = 0; i < redFilled.length; i++) {
    for (let j = i + 1; j < redFilled.length; j++) {
      const a = redFilled[i].champion!;
      const b = redFilled[j].champion!;
      const stat = stats.synergy_stats[synergyKey(a, b)];
      if (stat && stat.games >= MIN_SYNERGY_GAMES) {
        const aGames =
          stats.champion_role_stats[key2(a, redFilled[i].role)]?.games ?? 0;
        const bGames =
          stats.champion_role_stats[key2(b, redFilled[j].role)]?.games ?? 0;
        const pairMeta = Math.min(
          metaFactor(aGames, totals[redFilled[i].role]),
          metaFactor(bGames, totals[redFilled[j].role])
        );
        const syn = shrunkDelta(stat.winrate, stat.games) * pairMeta;
        blueEdge -= syn;
        breakdown.synergies.value -= syn;
        breakdown.synergies.games += stat.games;
      }
    }
  }

  const blueComp = compositionScore(blueFilled.map((s) => s.champion!), championMeta);
  const redComp = compositionScore(redFilled.map((s) => s.champion!), championMeta);
  blueEdge += blueComp - redComp;
  breakdown.composition.value = blueComp - redComp;
  // composition is rule-based, not stat-driven — games stays 0

  const blueWinrate = Math.max(0.05, Math.min(0.95, 0.5 + blueEdge));
  const redWinrate = 1 - blueWinrate;

  return {
    blue_winrate: blueWinrate,
    red_winrate: redWinrate,
    blue_edge: blueEdge,
    blue_filled: blueFilled.length,
    red_filled: redFilled.length,
    breakdown,
  };
}

// ---------- Recommendation ----------

export function recommend(
  stats: Stats,
  championMeta: ChampionMeta,
  allyTeam: DraftSlot[],
  enemyTeam: DraftSlot[],
  role: Role,
  topN: number = 5,
  userPool?: UserPool,
  bannedChampions?: Iterable<string>
): Recommendation[] {
  const allyFilled = allyTeam.filter((s) => s.champion);
  const enemyFilled = enemyTeam.filter((s) => s.champion);

  // Already-picked OR banned — neither can be recommended.
  const unavailable = new Set<string>([
    ...allyFilled.map((s) => s.champion!),
    ...enemyFilled.map((s) => s.champion!),
    ...(bannedChampions ?? []),
  ]);

  const candidates: string[] = [];
  for (const key of Object.keys(stats.champion_role_stats)) {
    const [champ, r] = key.split("|");
    if (r === role && !unavailable.has(champ)) {
      candidates.push(champ);
    }
  }

  let poolMax = 0;
  if (userPool) {
    for (const games of Object.values(userPool)) {
      if (games > poolMax) poolMax = games;
    }
  }

  const scored: Recommendation[] = [];

  const totals = roleTotals(stats);

  for (const champ of candidates) {
    const baseStat = stats.champion_role_stats[key2(champ, role)];
    if (!baseStat || baseStat.games < MIN_BASE_GAMES) continue;

    const pickRate = totals[role] > 0 ? baseStat.games / totals[role] : 0;
    const factor = metaFactor(baseStat.games, totals[role]);
    const baseDelta = shrunkDelta(baseStat.winrate, baseStat.games) * factor;

    let matchupDelta = 0;
    const breakdown: string[] = [];
    for (const enemy of enemyFilled) {
      if (!enemy.champion) continue;
      const ms =
        stats.matchup_stats[key4(champ, role, enemy.champion, enemy.role)];
      if (!ms) continue;
      const sameRole = enemy.role === role;
      const minGames = sameRole ? MIN_MATCHUP_GAMES : MIN_CROSS_ROLE_MATCHUP_GAMES;
      if (ms.games < minGames) continue;
      const weight = roleInteractionWeight(role, enemy.role);
      // Candidate's meta factor already computed above as `factor`.
      // Also dampen by the enemy's meta factor — symmetric treatment.
      const enemyGames =
        stats.champion_role_stats[key2(enemy.champion, enemy.role)]?.games ?? 0;
      const enemyMeta = metaFactor(enemyGames, totals[enemy.role]);
      const pairMeta = Math.min(factor, enemyMeta);
      const d = shrunkDelta(ms.winrate, ms.games) * weight * pairMeta;
      matchupDelta += d;
      if (Math.abs(d) >= 0.005) {
        const sign = d > 0 ? "+" : "";
        const tag = sameRole ? "" : ` [${enemy.role.toLowerCase()}, x${weight}]`;
        breakdown.push(
          `vs ${enemy.champion}${tag}: ${sign}${(d * 100).toFixed(1)}% (${ms.games} games)`
        );
      }
    }

    let synergyDelta = 0;
    for (const ally of allyFilled) {
      if (!ally.champion) continue;
      const ss = stats.synergy_stats[synergyKey(champ, ally.champion)];
      if (ss && ss.games >= MIN_SYNERGY_GAMES) {
        const allyGames =
          stats.champion_role_stats[key2(ally.champion, ally.role)]?.games ?? 0;
        const allyMeta = metaFactor(allyGames, totals[ally.role]);
        const pairMeta = Math.min(factor, allyMeta);
        const d = shrunkDelta(ss.winrate, ss.games) * pairMeta;
        synergyDelta += d;
        if (Math.abs(d) >= 0.01) {
          const sign = d > 0 ? "+" : "";
          breakdown.push(
            `w/ ${ally.champion}: ${sign}${(d * 100).toFixed(1)}% (${ss.games} games)`
          );
        }
      }
    }

    const proposedTeam = [
      ...allyFilled.map((s) => s.champion!),
      champ,
    ];
    const compWith = compositionScore(proposedTeam, championMeta);
    const compWithout = compositionScore(
      allyFilled.map((s) => s.champion!),
      championMeta
    );
    const compDelta = compWith - compWithout;
    if (Math.abs(compDelta) >= 0.005) {
      const sign = compDelta > 0 ? "+" : "";
      breakdown.push(`team comp: ${sign}${(compDelta * 100).toFixed(1)}%`);
    }

    let personalBonus = 0;
    if (userPool && poolMax > 0) {
      const userGames = userPool[key2(champ, role)] || 0;
      if (userGames > 0) {
        personalBonus = (userGames / poolMax) * PERSONAL_POOL_WEIGHT * 0.05;
        breakdown.push(`your pool: ${userGames} games`);
      }
    }

    const score = baseDelta + matchupDelta + synergyDelta + compDelta + personalBonus;

    if (factor < OFF_META_BADGE_THRESHOLD) {
      breakdown.push(
        `off-meta: ${(pickRate * 100).toFixed(2)}% pick rate → base credit ×${factor.toFixed(2)}`
      );
    }

    scored.push({
      champion: champ,
      score,
      base_winrate: baseStat.winrate,
      base_games: baseStat.games,
      pick_rate: pickRate,
      meta_factor: factor,
      matchup_delta: matchupDelta,
      synergy_delta: synergyDelta,
      composition_delta: compDelta,
      personal_bonus: personalBonus,
      breakdown,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
