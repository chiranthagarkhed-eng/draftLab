/**
 * Confidence treatment for sample-size-aware UI (PRD §5.3 / FR-5 / FR-6).
 *
 * The engine already shrinks deltas by sqrt(n) — the math handles thin data
 * internally. But the *display* should also broadcast that uncertainty
 * loudly: muted colors, sample-size badges, refusal callouts. This module
 * is the single source of truth for those rules so the UI stays consistent.
 */

export type ConfidenceLevel = "low" | "medium" | "high";

// Tuned to our dataset. With ~17k matches and our shrinkage reference of
// 1000 games, anything north of 500 games is essentially fully trusted by
// the engine. Below 100 is where the shrinkage really starts pulling.
const LOW_MAX = 100;
const MEDIUM_MAX = 500;

export function confidenceFromGames(games: number): ConfidenceLevel {
  if (games < LOW_MAX) return "low";
  if (games < MEDIUM_MAX) return "medium";
  return "high";
}

/**
 * The confidence level for an aggregate (e.g. all matchup deltas combined).
 * Uses the *minimum* across the contributing samples — a recommendation is
 * only as confident as its weakest input.
 */
export function aggregateConfidence(samples: number[]): ConfidenceLevel {
  if (samples.length === 0) return "low";
  const minGames = Math.min(...samples);
  return confidenceFromGames(minGames);
}

// ---------- CSS treatments ----------

/**
 * Tailwind classes per confidence level. We don't override colors entirely
 * (positive/negative still reads green/red) — we modulate opacity/saturation.
 */
export const CONFIDENCE_OPACITY: Record<ConfidenceLevel, string> = {
  low: "opacity-50",
  medium: "opacity-80",
  high: "opacity-100",
};

export const CONFIDENCE_TEXT: Record<ConfidenceLevel, string> = {
  low: "text-zinc-500",
  medium: "text-zinc-400",
  high: "text-zinc-300",
};

export const CONFIDENCE_BADGE_BG: Record<ConfidenceLevel, string> = {
  low: "bg-zinc-800 text-zinc-500 border-zinc-700/60",
  medium: "bg-zinc-800 text-zinc-300 border-zinc-700",
  high: "bg-emerald-950/40 text-emerald-300 border-emerald-700/40",
};

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  low: "low confidence",
  medium: "medium confidence",
  high: "high confidence",
};

// ---------- FR-6 thresholds ----------

/**
 * Top recommendation is considered "thin" if its base-games is below this.
 * Below the threshold we surface a warning + a higher-confidence alternative.
 */
export const THIN_PICK_GAMES_THRESHOLD = 200;

/**
 * Alternative must be both above this game count AND within this many
 * winrate points of the top pick for us to suggest swapping.
 */
export const ALTERNATIVE_MIN_GAMES = 500;
export const ALTERNATIVE_MAX_SCORE_GAP = 0.015; // 1.5 winrate points
