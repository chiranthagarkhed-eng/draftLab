/**
 * POST /api/commentary — stream a 2-3 sentence coaching rationale for a
 * single recommendation (PRD Pillar 2 / FR-4).
 *
 * GROUNDING DISCIPLINE
 * The model receives a structured Facts block of pre-computed stats and is
 * instructed to *narrate*, not to compute. The system prompt explicitly
 * forbids inventing winrates, percentages, or sample sizes that aren't in
 * the Facts block. This keeps Claude honest — the engine is still the
 * source of truth for numbers.
 *
 * KEY HANDLING
 * Reads ANTHROPIC_API_KEY from data/.env (single source with the rest of
 * our pipeline). If the key isn't present, returns 503 and the client
 * falls back to the structured breakdown UI.
 *
 * MODEL + COST
 * claude-haiku-4-5 at ~$0.25/M input, $1.25/M output. With ~500 input and
 * ~150 output tokens per call, each call is ~$0.0003 — comfortably under
 * the PRD's $0.02/session budget even with the eager top-3 generation
 * strategy (the client caches by draft signature so identical states
 * don't re-bill).
 */

import { promises as fs } from "fs";
import path from "path";

const MODEL = "claude-haiku-4-5";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 220; // ~2-3 sentences worth

export interface CommentaryRequest {
  champion: string;
  champion_display: string;
  role: string;
  score: number; // overall winrate-point delta
  base_winrate: number;
  base_games: number;
  matchup_delta: number;
  synergy_delta: number;
  composition_delta: number;
  personal_bonus: number;
  /** The pretty breakdown lines the engine already produced. */
  breakdown: string[];
  /** Ally picks (without the recommended slot). Used for narrative context. */
  ally_picks: Array<{ role: string; champion: string }>;
  /** Enemy picks. */
  enemy_picks: Array<{ role: string; champion: string }>;
}

// ---------- API key ----------

let cachedKey: string | null | undefined = undefined; // undefined = not tried yet

async function loadAnthropicKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey;
  // Prefer process.env so production deploys (Vercel et al.) work without
  // needing the data/.env file the Python pipeline uses.
  if (process.env.ANTHROPIC_API_KEY) {
    cachedKey = process.env.ANTHROPIC_API_KEY;
    return cachedKey;
  }
  // Local dev fallback: parse data/.env so we don't have to maintain two
  // copies of the key.
  try {
    const envPath = path.resolve(process.cwd(), "..", "data", ".env");
    const raw = await fs.readFile(envPath, "utf-8");
    const m = raw.match(/^\s*ANTHROPIC_API_KEY\s*=\s*"?([^\s"]+)"?/m);
    cachedKey = m ? m[1] : null;
  } catch {
    cachedKey = null;
  }
  return cachedKey;
}

// ---------- Prompt construction ----------

function pct(x: number): string {
  const sign = x > 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(1)}%`;
}

function buildFactsBlock(req: CommentaryRequest): string {
  const lines: string[] = [];
  lines.push(`Pick under consideration: ${req.champion_display} (${req.role})`);
  lines.push(`Overall score vs 50% baseline: ${pct(req.score)}`);
  lines.push(
    `Base champion winrate: ${(req.base_winrate * 100).toFixed(1)}% over ${req.base_games.toLocaleString()} games at this role`
  );
  if (Math.abs(req.matchup_delta) > 0.001)
    lines.push(`Matchups contribution: ${pct(req.matchup_delta)}`);
  if (Math.abs(req.synergy_delta) > 0.001)
    lines.push(`Synergies contribution: ${pct(req.synergy_delta)}`);
  if (Math.abs(req.composition_delta) > 0.001)
    lines.push(`Composition contribution: ${pct(req.composition_delta)}`);
  if (req.personal_bonus > 0.0005)
    lines.push(`Personal-pool bonus: ${pct(req.personal_bonus)}`);

  if (req.ally_picks.length > 0) {
    lines.push(
      `Ally team so far: ${req.ally_picks
        .map((p) => `${p.champion} (${p.role})`)
        .join(", ")}`
    );
  }
  if (req.enemy_picks.length > 0) {
    lines.push(
      `Enemy team so far: ${req.enemy_picks
        .map((p) => `${p.champion} (${p.role})`)
        .join(", ")}`
    );
  }

  if (req.breakdown.length > 0) {
    lines.push("");
    lines.push("Engine breakdown lines (already-computed deltas):");
    for (const b of req.breakdown) lines.push(`  - ${b}`);
  }

  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are a League of Legends draft coach embedded in DraftLab.
You write 2-3 sentence rationales that explain why a champion is a strong (or weak) pick in a given draft.

Hard rules:
- Only narrate the Facts you're given. Never invent winrates, percentages, sample sizes, or stats that aren't in the Facts block.
- Do NOT introduce new champions that aren't already in the draft state.
- Keep the tone confident but grounded — say "lower-ceiling but safer floor" rather than "guaranteed win".
- 2-3 sentences total. No lists, no headers, no markdown.
- Reference at least one concrete number from the Facts when relevant (e.g. the base winrate's sample size, or the matchup delta vs a specific enemy).
- If the score is barely positive, be honest about it.
`;

function buildUserPrompt(req: CommentaryRequest): string {
  return `Facts about this pick:
${buildFactsBlock(req)}

Write the rationale now.`;
}

// ---------- Handler ----------

export async function POST(req: Request) {
  let body: CommentaryRequest;
  try {
    body = (await req.json()) as CommentaryRequest;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.champion || !body.role) {
    return new Response(
      JSON.stringify({ error: "champion and role are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const apiKey = await loadAnthropicKey();
  if (!apiKey) {
    // 503 specifically — client treats this as "fall back to structured breakdown".
    return new Response(
      JSON.stringify({
        error: "ANTHROPIC_API_KEY not configured in data/.env",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  // Forward to Anthropic with stream=true. We re-pipe Anthropic's SSE through
  // to the client untouched — the client just reads delta events.
  const anthropicResp = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(body) }],
    }),
  });

  if (!anthropicResp.ok || !anthropicResp.body) {
    const text = await anthropicResp.text().catch(() => "");
    return new Response(
      JSON.stringify({
        error: `Anthropic API error: ${anthropicResp.status}`,
        detail: text.slice(0, 500),
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(anthropicResp.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
