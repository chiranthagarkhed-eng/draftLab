"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DraftSlot,
  Role,
  Recommendation,
  Stats,
  ChampionMeta,
  UserPool,
} from "@/lib/engine";
import { recommend } from "@/lib/engine";
import {
  championDisplayName,
  championPortraitUrl,
  loadChampionMeta,
  loadStats,
  ROLE_LABELS,
} from "@/lib/data";
import {
  confidenceFromGames,
  CONFIDENCE_OPACITY,
  CONFIDENCE_TEXT,
  THIN_PICK_GAMES_THRESHOLD,
  ALTERNATIVE_MIN_GAMES,
  ALTERNATIVE_MAX_SCORE_GAP,
} from "@/lib/confidence";
import ConfidenceBadge from "./ConfidenceBadge";
import { useCommentary, type UseCommentaryResult } from "@/lib/useCommentary";
import type { CommentaryRequest } from "@/app/api/commentary/route";

interface RecommendationsProps {
  allyTeam: DraftSlot[];
  enemyTeam: DraftSlot[];
  role: Role;
  onSelect: (champion: string) => void;
  userPool?: UserPool;
  bannedChampions?: Set<string>;
}

const EAGER_COMMENTARY_TOP_N = 3;

export default function Recommendations({
  allyTeam,
  enemyTeam,
  role,
  onSelect,
  userPool,
  bannedChampions,
}: RecommendationsProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [meta, setMeta] = useState<ChampionMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadStats(), loadChampionMeta()])
      .then(([s, m]) => {
        setStats(s);
        setMeta(m);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <Panel>
        <p className="text-red-400 text-sm">Failed to load engine data: {error}</p>
      </Panel>
    );
  }

  if (!stats || !meta) {
    return (
      <Panel>
        <p className="text-zinc-500 text-sm">Loading engine...</p>
      </Panel>
    );
  }

  const slotForRole = allyTeam.find((s) => s.role === role);
  if (slotForRole?.champion) {
    return (
      <Panel>
        <p className="text-zinc-400 text-sm">
          Your {ROLE_LABELS[role]} slot is already filled with{" "}
          <span className="text-zinc-100 font-medium">
            {championDisplayName(slotForRole.champion)}
          </span>
          . Pick a different role above to see recommendations.
        </p>
      </Panel>
    );
  }

  const recs: Recommendation[] = recommend(
    stats,
    meta,
    allyTeam,
    enemyTeam,
    role,
    20,
    userPool,
    bannedChampions
  );

  const thinWarning = computeThinWarning(recs);
  const visible = recs.slice(0, 5);

  return (
    <Panel>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald-400">
          Top picks for {ROLE_LABELS[role]}
        </h3>
        {userPool && (
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            personalized
          </span>
        )}
      </div>

      {thinWarning && (
        <div className="mb-3 border border-amber-800/60 bg-amber-950/30 rounded p-2.5 text-xs text-amber-200/90">
          <div className="font-medium text-amber-300 mb-0.5">
            Top pick is thin data
          </div>
          <div>
            <span className="font-mono">
              {championDisplayName(thinWarning.topChampion)}
            </span>{" "}
            only has {thinWarning.topGames.toLocaleString()} games at this role.
            {thinWarning.alternative ? (
              <>
                {" "}
                Higher-confidence alternative:{" "}
                <span className="font-mono text-amber-100">
                  {championDisplayName(thinWarning.alternative.champion)}
                </span>{" "}
                at {(thinWarning.alternative.score * 100).toFixed(1)}% (
                {thinWarning.alternative.base_games.toLocaleString()} games).
              </>
            ) : (
              " No higher-confidence alternative is within range — keep the small numbers in mind."
            )}
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-zinc-500 text-sm italic">
          Not enough data for this role yet. Try collecting more matches.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((r, i) => (
            <RecCard
              key={r.champion}
              rec={r}
              rank={i + 1}
              role={role}
              allyTeam={allyTeam}
              enemyTeam={enemyTeam}
              eager={i < EAGER_COMMENTARY_TOP_N}
              expanded={expanded === r.champion}
              onToggle={() =>
                setExpanded(expanded === r.champion ? null : r.champion)
              }
              onPick={() => onSelect(r.champion)}
            />
          ))}
        </ul>
      )}

      <p className="text-[10px] text-zinc-600 mt-3">
        Scores are winrate-point deltas vs a 50% baseline, shrunk for sample
        size. Coaching commentary is generated from the engine&apos;s numbers
        — no invented stats.
      </p>
    </Panel>
  );
}

// ---------- Per-card subcomponent (needed so each rec can hold its own hook) ----------

function RecCard({
  rec,
  rank,
  role,
  allyTeam,
  enemyTeam,
  eager,
  expanded,
  onToggle,
  onPick,
}: {
  rec: Recommendation;
  rank: number;
  role: Role;
  allyTeam: DraftSlot[];
  enemyTeam: DraftSlot[];
  eager: boolean;
  expanded: boolean;
  onToggle: () => void;
  onPick: () => void;
}) {
  const conf = confidenceFromGames(rec.base_games);
  const scorePct = (rec.score * 100).toFixed(1);

  // Build the structured request for the commentary endpoint. Memoize so
  // the hook's signature stays stable across rerenders of the same draft.
  const commentaryReq: CommentaryRequest = useMemo(
    () => ({
      champion: rec.champion,
      champion_display: championDisplayName(rec.champion),
      role,
      score: rec.score,
      base_winrate: rec.base_winrate,
      base_games: rec.base_games,
      matchup_delta: rec.matchup_delta,
      synergy_delta: rec.synergy_delta,
      composition_delta: rec.composition_delta,
      personal_bonus: rec.personal_bonus,
      breakdown: rec.breakdown,
      ally_picks: allyTeam
        .filter((s) => s.champion)
        .map((s) => ({
          role: s.role,
          champion: championDisplayName(s.champion!),
        })),
      enemy_picks: enemyTeam
        .filter((s) => s.champion)
        .map((s) => ({
          role: s.role,
          champion: championDisplayName(s.champion!),
        })),
    }),
    [rec, role, allyTeam, enemyTeam]
  );

  // Eager (top 3): always fetch. Non-eager: only fetch when the user
  // expands the card via "why?".
  const commentary = useCommentary(commentaryReq, eager || expanded);

  return (
    <li className="border border-zinc-800 rounded p-2 hover:border-zinc-600 transition">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="w-6 text-center text-xs text-zinc-500 font-mono shrink-0">
          #{rank}
        </div>
        <img
          src={championPortraitUrl(rec.champion)}
          alt={championDisplayName(rec.champion)}
          className="w-10 h-10 rounded shrink-0"
          onError={(e) =>
            ((e.currentTarget as HTMLImageElement).style.opacity = "0.3")
          }
        />
        <div className="flex-1 min-w-[8rem]">
          <div className="font-medium truncate">
            {championDisplayName(rec.champion)}
          </div>
          <div
            className={`text-xs flex items-center gap-2 flex-wrap ${CONFIDENCE_TEXT[conf]}`}
          >
            <span>{(rec.base_winrate * 100).toFixed(1)}% base wr</span>
            <ConfidenceBadge games={rec.base_games} compact />
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className={`text-sm font-mono font-semibold ${
              rec.score > 0 ? "text-emerald-400" : "text-zinc-400"
            } ${CONFIDENCE_OPACITY[conf]}`}
          >
            {rec.score > 0 ? "+" : ""}
            {scorePct}%
          </div>
          <button
            onClick={onToggle}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 underline"
          >
            {expanded ? "hide" : "why?"}
          </button>
        </div>
        <button
          onClick={onPick}
          className="ml-auto sm:ml-0 px-3 py-1.5 min-h-9 bg-emerald-500/20 hover:bg-emerald-500/40 active:bg-emerald-500/50 text-emerald-300 text-xs font-medium rounded transition shrink-0"
        >
          Pick
        </button>
      </div>

      {/* Eager cards always show their coaching line (when available); */}
      {/* non-eager cards reveal it on "why?". */}
      {(eager || expanded) && (
        <CoachingBlock rec={rec} commentary={commentary} />
      )}
    </li>
  );
}

function CoachingBlock({
  rec,
  commentary,
}: {
  rec: Recommendation;
  commentary: UseCommentaryResult;
}) {
  // Fall back to structured breakdown when the LLM can't help.
  if (commentary.status === "error" || commentary.status === "disabled") {
    return <StructuredBreakdown rec={rec} note={commentary.status} />;
  }
  if (
    (commentary.status === "loading" || commentary.status === "idle") &&
    !commentary.text
  ) {
    return (
      <p className="mt-2 ml-9 text-xs text-zinc-500 italic">
        <span className="inline-block w-3 h-3 mr-2 align-middle border-2 border-emerald-500/40 border-t-emerald-400 rounded-full animate-spin" />
        Coaching…
      </p>
    );
  }
  return (
    <div className="mt-2 ml-9 text-xs text-zinc-300 leading-relaxed">
      {commentary.text}
      {commentary.status === "streaming" && (
        <span className="inline-block w-1.5 h-3 ml-0.5 bg-emerald-400/70 align-middle animate-pulse" />
      )}
    </div>
  );
}

function StructuredBreakdown({
  rec,
  note,
}: {
  rec: Recommendation;
  note: "error" | "disabled";
}) {
  function prettifyBreakdown(line: string): string {
    return line.replace(/\b([A-Z][a-zA-Z]+)\b/g, (m) => championDisplayName(m));
  }
  if (rec.breakdown.length === 0) {
    return (
      <p className="mt-2 ml-9 text-xs text-zinc-500 italic">
        Score is from base winrate only — no relevant matchup or synergy data
        yet.
      </p>
    );
  }
  return (
    <div className="mt-2 ml-9 text-xs space-y-0.5">
      <ul className="text-zinc-400 space-y-0.5">
        {rec.breakdown.map((line, idx) => (
          <li key={idx} className={lineConfidenceClass(line)}>
            · {prettifyBreakdown(line)}
          </li>
        ))}
      </ul>
      <div className="text-[10px] text-zinc-600 italic mt-1">
        {note === "disabled"
          ? "Showing structured breakdown — set ANTHROPIC_API_KEY in data/.env to get coaching commentary."
          : "Coaching unavailable — showing structured breakdown instead."}
      </div>
    </div>
  );
}

function lineConfidenceClass(line: string): string {
  const m = line.match(/\((\d+)\s+games?\)/);
  if (!m) return "";
  const games = parseInt(m[1], 10);
  const conf = confidenceFromGames(games);
  return CONFIDENCE_OPACITY[conf];
}

function computeThinWarning(
  recs: Recommendation[]
): { topChampion: string; topGames: number; alternative: Recommendation | null } | null {
  if (recs.length === 0) return null;
  const top = recs[0];
  if (top.base_games >= THIN_PICK_GAMES_THRESHOLD) return null;
  const alternative =
    recs
      .slice(1)
      .find(
        (r) =>
          r.base_games >= ALTERNATIVE_MIN_GAMES &&
          top.score - r.score <= ALTERNATIVE_MAX_SCORE_GAP
      ) ?? null;
  return {
    topChampion: top.champion,
    topGames: top.base_games,
    alternative,
  };
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/40">
      {children}
    </div>
  );
}
