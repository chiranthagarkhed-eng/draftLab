// Data loaders for stats.json and champion_meta.json.
// Cached so multiple components don't re-fetch.
// Normalizes the array-of-objects shape from compile_stats.py into the
// keyed-dict shape that the engine expects (O(1) lookups).

import type { Stats, ChampionMeta, Role } from "./engine";

export const ROLES: Role[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

export const ROLE_LABELS: Record<Role, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "Bot",
  UTILITY: "Support",
};

// ---------- Display-name overrides ----------
// Data Dragon uses internal IDs that differ from in-game names. The engine
// and stats.json use the internal name — only UI strings use the friendly one.

const DISPLAY_NAME_MAP: Record<string, string> = {
  MonkeyKing: "Wukong",
  Chogath: "Cho'Gath",
  Khazix: "Kha'Zix",
  KogMaw: "Kog'Maw",
  Velkoz: "Vel'Koz",
  DrMundo: "Dr. Mundo",
  TahmKench: "Tahm Kench",
  AurelionSol: "Aurelion Sol",
  KSante: "K'Sante",
  Belveth: "Bel'Veth",
  Renata: "Renata Glasc",
  JarvanIV: "Jarvan IV",
  MasterYi: "Master Yi",
  MissFortune: "Miss Fortune",
  LeeSin: "Lee Sin",
  TwistedFate: "Twisted Fate",
  XinZhao: "Xin Zhao",
  LeBlanc: "LeBlanc",
  Leblanc: "LeBlanc",
};

export function championDisplayName(internalName: string): string {
  return DISPLAY_NAME_MAP[internalName] ?? internalName;
}

/**
 * Returns true if a query matches a champion's internal name or display name.
 * Case-insensitive, substring match.
 */
export function championMatchesQuery(
  internalName: string,
  query: string
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (internalName.toLowerCase().includes(q)) return true;
  return championDisplayName(internalName).toLowerCase().includes(q);
}

// ---------- Raw file shapes (what compile_stats.py / fetch_champion_meta.py output) ----------

interface RawChampionRoleStat {
  champion: string;
  role: Role;
  games: number;
  wins: number;
  winrate: number;
}

interface RawMatchupStat {
  champion: string;
  vs_champion: string;
  role: Role;
  vs_role?: Role;
  games: number;
  wins: number;
  winrate: number;
}

interface RawSynergyStat {
  champion_a: string;
  champion_b: string;
  games: number;
  wins: number;
  winrate: number;
}

interface StatsFile {
  meta?: {
    matches_processed: number;
    matches_skipped: number;
    participants_processed: number;
  };
  champion_role_stats: RawChampionRoleStat[];
  matchup_stats: RawMatchupStat[];
  synergy_stats: RawSynergyStat[];
}

interface ChampionMetaFile {
  patch: string;
  champions: ChampionMeta;
}

// ---------- Module-level cache ----------

let statsCache: Promise<Stats> | null = null;
let metaCache: Promise<ChampionMeta> | null = null;
let metaPatchCache: string | null = null;
let datasetMetaCache: DatasetMeta | null = null;

// ---------- Dataset meta (for FR-7: patch + freshness footer) ----------

export interface DatasetMeta {
  matches_processed: number;
  matches_skipped: number;
  participants_processed: number;
  patch: string | null;
  rank_bracket: string;
}

// ---------- Normalizers ----------

function normalizeStats(file: StatsFile): Stats {
  const champion_role_stats: Stats["champion_role_stats"] = {};
  for (const e of file.champion_role_stats) {
    champion_role_stats[`${e.champion}|${e.role}`] = {
      games: e.games,
      wins: e.wins,
      winrate: e.winrate,
    };
  }

  const matchup_stats: Stats["matchup_stats"] = {};
  for (const e of file.matchup_stats) {
    const vsRole = e.vs_role ?? e.role;
    matchup_stats[`${e.champion}|${e.role}|${e.vs_champion}|${vsRole}`] = {
      games: e.games,
      wins: e.wins,
      winrate: e.winrate,
    };
  }

  const synergy_stats: Stats["synergy_stats"] = {};
  for (const e of file.synergy_stats) {
    const key =
      e.champion_a < e.champion_b
        ? `${e.champion_a}|${e.champion_b}`
        : `${e.champion_b}|${e.champion_a}`;
    synergy_stats[key] = {
      games: e.games,
      wins: e.wins,
      winrate: e.winrate,
    };
  }

  return { champion_role_stats, matchup_stats, synergy_stats };
}

// ---------- Loaders ----------

export function loadStats(): Promise<Stats> {
  if (!statsCache) {
    statsCache = fetch("/stats.json")
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load stats.json: ${r.status}`);
        return r.json() as Promise<StatsFile>;
      })
      .then((file) => {
        if (file.meta) {
          datasetMetaCache = {
            ...file.meta,
            patch: metaPatchCache,
            rank_bracket: "Emerald+",
          };
        }
        return normalizeStats(file);
      });
  }
  return statsCache;
}

export function loadChampionMeta(): Promise<ChampionMeta> {
  if (!metaCache) {
    metaCache = fetch("/champion_meta.json")
      .then((r) => {
        if (!r.ok)
          throw new Error(`Failed to load champion_meta.json: ${r.status}`);
        return r.json() as Promise<ChampionMetaFile>;
      })
      .then((file) => {
        metaPatchCache = file.patch;
        return file.champions;
      });
  }
  return metaCache;
}

/**
 * Loads the dataset meta (match count, patch, rank bracket) for the FR-7
 * persistent footer. Cheap — reuses the caches that loadStats /
 * loadChampionMeta already populated.
 */
export async function loadDatasetMeta(): Promise<DatasetMeta> {
  await Promise.all([loadStats(), loadChampionMeta()]);
  if (!datasetMetaCache) {
    throw new Error("dataset meta was not populated by loadStats");
  }
  return { ...datasetMetaCache, patch: metaPatchCache };
}

// ---------- Helpers ----------

export function listAllChampions(meta: ChampionMeta): string[] {
  return Object.keys(meta).sort();
}

const DDRAGON_FALLBACK_PATCH = "16.10.1";

export function championPortraitUrl(championName: string): string {
  const patch = metaPatchCache ?? DDRAGON_FALLBACK_PATCH;
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/champion/${championName}.png`;
}

// ---------- User pool (localStorage, FR-2 / FR-3) ----------

/**
 * Server payload shape — same as what /api/pool returns. Keep this aligned
 * with UserPoolPayload in app/api/pool/route.ts.
 */
export interface StoredUserPool {
  account: { game_name: string; tag_line: string; puuid: string };
  matches_analyzed: number;
  fetched_at: string; // ISO timestamp set when we save
  pool: Partial<
    Record<
      Role,
      Array<{ champion: string; games: number; wins: number; winrate: number }>
    >
  >;
}

const USER_POOL_STORAGE_KEY = "draftlab.userPool.v1";

export function saveUserPool(payload: Omit<StoredUserPool, "fetched_at">): StoredUserPool {
  const stored: StoredUserPool = {
    ...payload,
    fetched_at: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(USER_POOL_STORAGE_KEY, JSON.stringify(stored));
  }
  return stored;
}

export function loadStoredUserPool(): StoredUserPool | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_POOL_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUserPool;
  } catch {
    return null;
  }
}

export function clearStoredUserPool(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(USER_POOL_STORAGE_KEY);
}

/**
 * Convert the StoredUserPool shape ({role: [{champion, games, ...}]}) into
 * the engine's UserPool shape ({"ChampName|ROLE": games}).
 */
import type { UserPool } from "./engine";
export function toEnginePool(stored: StoredUserPool | null): UserPool | undefined {
  if (!stored) return undefined;
  const out: UserPool = {};
  for (const role of ROLES) {
    const entries = stored.pool[role];
    if (!entries) continue;
    for (const e of entries) {
      out[`${e.champion}|${role}`] = e.games;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
