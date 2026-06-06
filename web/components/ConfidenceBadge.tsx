import {
  confidenceFromGames,
  CONFIDENCE_BADGE_BG,
  CONFIDENCE_LABEL,
} from "@/lib/confidence";

/**
 * Tiny pill that shows a sample size and color-codes its confidence.
 * Used wherever a numerical stat appears (PRD FR-5).
 */
export default function ConfidenceBadge({
  games,
  compact = false,
}: {
  games: number;
  compact?: boolean;
}) {
  const level = confidenceFromGames(games);
  const bg = CONFIDENCE_BADGE_BG[level];
  const text = compact
    ? `${games.toLocaleString()}g`
    : `${games.toLocaleString()} games`;
  return (
    <span
      title={`${games.toLocaleString()} games — ${CONFIDENCE_LABEL[level]}`}
      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono ${bg}`}
    >
      {text}
    </span>
  );
}
