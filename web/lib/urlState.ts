/**
 * URL state codec for draft sharing (PRD FR-10).
 *
 * The full draft state is encoded into the page's query string so any draft
 * is one URL away from sharing — no backend storage, no link shortener.
 *
 * Format (kept short and human-readable so URLs are debuggable):
 *
 *   /draft
 *     ?b=Garen,Graves,Ahri,Caitlyn,Nami        (blue picks, 5 fixed positions: TOP,JG,MID,BOT,SUP)
 *     &r=Yasuo,XinZhao,Yone,Jinx,Senna         (red picks, same order)
 *     &bb=Akali,Kayn,_,_,_                     (blue bans, _ = empty slot)
 *     &rb=Yasuo,Yone,_,_,_                     (red bans)
 *     &side=blue                                (user's side)
 *     &role=MIDDLE                              (user's intended role)
 *
 * Empty slots use "_" (URL-safe, unambiguous). A fully empty draft produces
 * no params at all — we don't pollute clean URLs with placeholder data.
 *
 * Champion names come from Riot's internal IDs (Caitlyn, MissFortune,
 * KogMaw, etc.) — those are all alphanumeric, so no escaping needed beyond
 * URLSearchParams' built-in.
 */

import type { DraftSlot, Role } from "./engine";

export type Side = "blue" | "red";

const ROLE_ORDER: Role[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const SIDES: Side[] = ["blue", "red"];
const EMPTY = "_";

export interface DraftState {
  blueTeam: DraftSlot[];
  redTeam: DraftSlot[];
  blueBans: (string | null)[];
  redBans: (string | null)[];
  userSide: Side;
  userRole: Role;
}

/** Build an empty team in canonical role order. */
export function emptyTeam(): DraftSlot[] {
  return ROLE_ORDER.map((role) => ({ role, champion: null }));
}

export function emptyBans(): (string | null)[] {
  return Array(5).fill(null);
}

// ---------- Encoder ----------

function encodeTeam(team: DraftSlot[]): string | null {
  // Reorder to canonical TOP,JG,MID,BOT,SUP slot positions.
  const byRole = new Map(team.map((s) => [s.role, s.champion]));
  const values = ROLE_ORDER.map((r) => byRole.get(r) ?? null);
  const allEmpty = values.every((v) => !v);
  if (allEmpty) return null;
  return values.map((v) => v ?? EMPTY).join(",");
}

function encodeBans(bans: (string | null)[]): string | null {
  // Pad/truncate to 5 then encode. All empty -> omit.
  const padded = [0, 1, 2, 3, 4].map((i) => bans[i] ?? null);
  if (padded.every((v) => !v)) return null;
  return padded.map((v) => v ?? EMPTY).join(",");
}

/**
 * Build a URLSearchParams that, when set on /draft, reproduces the given
 * state. Empty pieces are omitted so unused drafts produce clean URLs.
 */
export function encodeDraftState(state: DraftState): URLSearchParams {
  const params = new URLSearchParams();
  const b = encodeTeam(state.blueTeam);
  if (b) params.set("b", b);
  const r = encodeTeam(state.redTeam);
  if (r) params.set("r", r);
  const bb = encodeBans(state.blueBans);
  if (bb) params.set("bb", bb);
  const rb = encodeBans(state.redBans);
  if (rb) params.set("rb", rb);
  // Only emit side/role when they differ from the defaults so common cases
  // stay clean.
  if (state.userSide !== "blue") params.set("side", state.userSide);
  if (state.userRole !== "MIDDLE") params.set("role", state.userRole);
  return params;
}

/**
 * Convenience: returns "?…" string (or "" if empty). Use when assigning
 * window.location or building a copy-paste URL.
 */
export function encodeDraftStateString(state: DraftState): string {
  const p = encodeDraftState(state).toString();
  return p ? `?${p}` : "";
}

// ---------- Decoder ----------

function decodeTeam(raw: string | null): DraftSlot[] {
  if (!raw) return emptyTeam();
  const parts = raw.split(",");
  return ROLE_ORDER.map((role, i) => {
    const v = parts[i];
    const champion = !v || v === EMPTY ? null : v;
    return { role, champion };
  });
}

function decodeBans(raw: string | null): (string | null)[] {
  if (!raw) return emptyBans();
  const parts = raw.split(",");
  return [0, 1, 2, 3, 4].map((i) => {
    const v = parts[i];
    return !v || v === EMPTY ? null : v;
  });
}

function decodeSide(raw: string | null): Side {
  return SIDES.includes(raw as Side) ? (raw as Side) : "blue";
}

function decodeRole(raw: string | null): Role {
  return ROLE_ORDER.includes(raw as Role) ? (raw as Role) : "MIDDLE";
}

/**
 * Parse a URLSearchParams (or anything with .get(key)) back into draft
 * state. Missing/malformed inputs fall back to sane defaults; we never
 * throw — sharing should be forgiving.
 */
export function decodeDraftState(params: URLSearchParams): DraftState {
  return {
    blueTeam: decodeTeam(params.get("b")),
    redTeam: decodeTeam(params.get("r")),
    blueBans: decodeBans(params.get("bb")),
    redBans: decodeBans(params.get("rb")),
    userSide: decodeSide(params.get("side")),
    userRole: decodeRole(params.get("role")),
  };
}
