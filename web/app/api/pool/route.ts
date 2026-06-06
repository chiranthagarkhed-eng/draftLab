/**
 * POST /api/pool — server-side Riot pool fetcher.
 *
 * Mirrors data/fetch_user_pool.py: takes a Riot ID, resolves it to a PUUID,
 * pulls recent ranked-solo matches, and aggregates the user's picks into a
 * per-role champion pool.
 *
 * Server-side so RIOT_API_KEY stays off the client. The key is read once
 * at request time from data/.env (single source of truth — same file the
 * Python pipeline uses).
 *
 * NOTE: this is slow — at ~1.3s per API call x ~30 calls, expect ~40-60s
 * to complete. In production this should become a streaming or queued job;
 * for the MVP it's a blocking POST with a spinner on the client.
 */

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const MATCHES_TO_ANALYZE = 30;
const SLEEP_BETWEEN_REQUESTS_MS = 1300;
const REGIONAL_HOST = "https://americas.api.riotgames.com";

// Roles used by Riot's match-v5 teamPosition field
type Role = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";
const ROLES: Role[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

export interface PoolChampionEntry {
  champion: string;
  games: number;
  wins: number;
  winrate: number;
}

export interface UserPoolPayload {
  account: { game_name: string; tag_line: string; puuid: string };
  matches_analyzed: number;
  pool: Partial<Record<Role, PoolChampionEntry[]>>;
}

// ---------- API key loading ----------

let cachedKey: string | null = null;

async function loadRiotKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  // Prefer process.env so Vercel deploys work without needing data/.env in the
  // deployed bundle.
  if (process.env.RIOT_API_KEY) {
    cachedKey = process.env.RIOT_API_KEY;
    return cachedKey;
  }
  // Local dev fallback: read from data/.env (single source with the Python
  // pipeline).
  const envPath = path.resolve(process.cwd(), "..", "data", ".env");
  const raw = await fs.readFile(envPath, "utf-8");
  const match = raw.match(/^\s*RIOT_API_KEY\s*=\s*"?([^\s"]+)"?/m);
  if (!match) {
    throw new Error(`RIOT_API_KEY not found in ${envPath} or process.env`);
  }
  cachedKey = match[1];
  return cachedKey;
}

// ---------- Riot fetch with retry/backoff ----------

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * TS equivalent of data/riot_api.py get_with_retry — handles 429 via
 * Retry-After (or 10s fallback), 5xx with exponential backoff. Returns
 * the final Response; caller handles 200/4xx.
 */
async function riotFetch(url: string, apiKey: string): Promise<Response> {
  const headers = { "X-Riot-Token": apiKey };
  const MAX_5XX_RETRIES = 3;
  let backoff = 2000;
  let attempt5xx = 0;
  while (true) {
    const resp = await fetch(url, { headers });
    if (resp.status === 429) {
      const ra = parseFloat(resp.headers.get("Retry-After") ?? "");
      const waitMs = Number.isFinite(ra) ? ra * 1000 : 10_000;
      console.log(`[api/pool] 429 — waiting ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }
    if (resp.status >= 500) {
      if (attempt5xx >= MAX_5XX_RETRIES) return resp;
      console.log(
        `[api/pool] ${resp.status} — backoff ${backoff}ms (retry ${attempt5xx + 1}/${MAX_5XX_RETRIES})`
      );
      await sleep(backoff);
      attempt5xx += 1;
      backoff *= 2;
      continue;
    }
    return resp;
  }
}

// ---------- Riot data shapes (only what we read) ----------

interface AccountResponse {
  puuid: string;
  gameName: string;
  tagLine: string;
}

interface MatchResponse {
  info: {
    participants: Array<{
      puuid: string;
      championName: string;
      teamPosition: string;
      win: boolean;
    }>;
  };
}

// ---------- Handler ----------

export async function POST(req: Request) {
  let body: { gameName?: string; tagLine?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const gameName = (body.gameName ?? "").trim();
  const tagLine = (body.tagLine ?? "").trim();
  if (!gameName || !tagLine) {
    return NextResponse.json(
      { error: "gameName and tagLine are required" },
      { status: 400 }
    );
  }

  let apiKey: string;
  try {
    apiKey = await loadRiotKey();
  } catch (e) {
    return NextResponse.json(
      { error: `Couldn't load Riot API key: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  // 1) Resolve Riot ID -> PUUID
  const accountUrl = `${REGIONAL_HOST}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
    gameName
  )}/${encodeURIComponent(tagLine)}`;
  const accountResp = await riotFetch(accountUrl, apiKey);
  if (accountResp.status === 404) {
    return NextResponse.json(
      { error: `No account found for ${gameName}#${tagLine}` },
      { status: 404 }
    );
  }
  if (!accountResp.ok) {
    return NextResponse.json(
      {
        error: `Riot account lookup failed: ${accountResp.status}`,
        detail: await accountResp.text(),
      },
      { status: 502 }
    );
  }
  const account = (await accountResp.json()) as AccountResponse;

  // 2) Recent ranked-solo match IDs (queue=420)
  const matchIdsUrl =
    `${REGIONAL_HOST}/lol/match/v5/matches/by-puuid/${account.puuid}/ids` +
    `?queue=420&count=${MATCHES_TO_ANALYZE}`;
  const matchIdsResp = await riotFetch(matchIdsUrl, apiKey);
  if (!matchIdsResp.ok) {
    return NextResponse.json(
      {
        error: `Couldn't fetch match history: ${matchIdsResp.status}`,
        detail: await matchIdsResp.text(),
      },
      { status: 502 }
    );
  }
  const matchIds = (await matchIdsResp.json()) as string[];
  if (matchIds.length === 0) {
    return NextResponse.json(
      { error: "No ranked solo matches found for this account." },
      { status: 404 }
    );
  }

  // 3) For each match, find this player's pick and outcome
  const pool: Record<string, Record<string, { games: number; wins: number }>> = {};

  for (let i = 0; i < matchIds.length; i++) {
    const matchUrl = `${REGIONAL_HOST}/lol/match/v5/matches/${matchIds[i]}`;
    const r = await riotFetch(matchUrl, apiKey);
    if (r.ok) {
      const match = (await r.json()) as MatchResponse;
      for (const p of match.info.participants) {
        if (p.puuid !== account.puuid) continue;
        const role = p.teamPosition;
        if (!role) break;
        pool[role] ??= {};
        pool[role][p.championName] ??= { games: 0, wins: 0 };
        pool[role][p.championName].games += 1;
        if (p.win) pool[role][p.championName].wins += 1;
        break;
      }
    }
    // Pace ourselves between calls. riotFetch already handles 429 if we hit it.
    if (i < matchIds.length - 1) await sleep(SLEEP_BETWEEN_REQUESTS_MS);
  }

  // 4) Sort each role's champs by games played, build payload
  const poolOut: UserPoolPayload["pool"] = {};
  for (const role of ROLES) {
    if (!pool[role]) continue;
    const entries: PoolChampionEntry[] = Object.entries(pool[role])
      .map(([champion, s]) => ({
        champion,
        games: s.games,
        wins: s.wins,
        winrate: s.games > 0 ? Math.round((s.wins / s.games) * 10000) / 10000 : 0,
      }))
      .sort((a, b) => b.games - a.games);
    poolOut[role] = entries;
  }

  const payload: UserPoolPayload = {
    account: {
      game_name: account.gameName,
      tag_line: account.tagLine,
      puuid: account.puuid,
    },
    matches_analyzed: matchIds.length,
    pool: poolOut,
  };

  return NextResponse.json(payload);
}
