"use client";

import { useEffect, useState } from "react";
import type {
  DraftSlot,
  Stats,
  ChampionMeta,
  MatchupEvaluation,
  WeightedDelta,
} from "@/lib/engine";
import { evaluateMatchup } from "@/lib/engine";
import { loadStats, loadChampionMeta } from "@/lib/data";
import {
  confidenceFromGames,
  aggregateConfidence,
  CONFIDENCE_LABEL,
  CONFIDENCE_TEXT,
  CONFIDENCE_OPACITY,
} from "@/lib/confidence";
import ConfidenceBadge from "./ConfidenceBadge";

type Side = "blue" | "red";

interface MatchupAnalysisProps {
  blueTeam: DraftSlot[];
  redTeam: DraftSlot[];
  userSide: Side;
}

/**
 * Live win-probability readout for the current draft state. Re-runs
 * evaluateMatchup whenever either team changes. Per PRD §5.3 / FR-5, every
 * numerical contribution shows a sample-size badge and is visually muted
 * when low-confidence.
 */
export default function MatchupAnalysis({
  blueTeam,
  redTeam,
  userSide,
}: MatchupAnalysisProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [meta, setMeta] = useState<ChampionMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <p className="text-red-400 text-sm">
          Couldn&apos;t load engine data: {error}
        </p>
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

  const evalResult = evaluateMatchup(stats, meta, blueTeam, redTeam);
  return <MatchupReadout result={evalResult} userSide={userSide} />;
}

function MatchupReadout({
  result,
  userSide,
}: {
  result: MatchupEvaluation;
  userSide: Side;
}) {
  const {
    blue_winrate,
    red_winrate,
    blue_edge,
    blue_filled,
    red_filled,
    breakdown,
  } = result;

  const empty = blue_filled === 0 && red_filled === 0;
  const partial = !empty && (blue_filled < 5 || red_filled < 5);

  const userWinrate = userSide === "blue" ? blue_winrate : red_winrate;
  // Breakdown is "blue's perspective"; flip if user is red.
  const sign = userSide === "blue" ? 1 : -1;
  const userEdge = blue_edge * sign;

  // Pull aggregate confidence from the components that actually have stats.
  // Composition is rule-based — exclude it from the confidence calculation
  // (otherwise it'd always show as "low confidence" since games is 0).
  const sampleSizes = [
    breakdown.base.games,
    breakdown.matchups.games,
    breakdown.synergies.games,
  ].filter((g) => g > 0);
  const overallConfidence = empty
    ? "low"
    : sampleSizes.length === 0
    ? "low"
    : aggregateConfidence(sampleSizes);

  const verdict =
    Math.abs(userEdge) < 0.01
      ? "Coin flip"
      : userEdge > 0.05
      ? "Strong favorite"
      : userEdge > 0.02
      ? "Slight favorite"
      : userEdge > -0.02
      ? "Even"
      : userEdge > -0.05
      ? "Slight underdog"
      : "Strong underdog";

  return (
    <Panel>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald-400">
          Expected win rate
        </h3>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
          {empty
            ? "draft empty"
            : partial
            ? `partial draft · ${blue_filled}v${red_filled}`
            : "full draft · 5v5"}
        </span>
      </div>

      {/* Headline number — user's POV. Opacity reflects overall confidence. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
        <div
          className={`text-3xl sm:text-4xl font-mono font-bold ${
            userEdge > 0.005
              ? "text-emerald-400"
              : userEdge < -0.005
              ? "text-red-400"
              : "text-zinc-300"
          } ${CONFIDENCE_OPACITY[overallConfidence]}`}
        >
          {(userWinrate * 100).toFixed(1)}%
        </div>
        <div className="text-xs text-zinc-500 uppercase tracking-wider">
          You ({userSide}) · {verdict}
        </div>
      </div>
      {!empty && (
        <div className="mb-3 text-[10px] text-zinc-500">
          {CONFIDENCE_LABEL[overallConfidence]}
        </div>
      )}

      <SplitBar blueWinrate={blue_winrate} redWinrate={red_winrate} />

      <div className="flex justify-between text-[11px] text-zinc-500 mt-1 mb-4 font-mono">
        <span>Blue {(blue_winrate * 100).toFixed(1)}%</span>
        <span>Red {(red_winrate * 100).toFixed(1)}%</span>
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
          How the edge breaks down ({userSide === "blue" ? "you" : "you (red)"}{" "}
          minus enemy, in winrate points)
        </div>
        <BreakdownRow
          label="Base champion strength"
          d={breakdown.base}
          sign={sign}
        />
        <BreakdownRow
          label="Matchups (in-lane + cross-role)"
          d={breakdown.matchups}
          sign={sign}
        />
        <BreakdownRow
          label="Team synergies"
          d={breakdown.synergies}
          sign={sign}
        />
        <BreakdownRow
          label="Composition (frontline / damage / range)"
          d={breakdown.composition}
          sign={sign}
          ruleBased
        />
        <div className="border-t border-zinc-800 pt-1.5 mt-1.5">
          <div className="flex justify-between">
            <span className="text-zinc-200 font-medium">Net edge</span>
            <span
              className={`font-mono font-semibold ${
                userEdge > 0.002
                  ? "text-emerald-400"
                  : userEdge < -0.002
                  ? "text-red-400"
                  : "text-zinc-500"
              }`}
            >
              {userEdge > 0 ? "+" : ""}
              {(userEdge * 100).toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-zinc-600 mt-3">
        Win-rate is clamped to 5–95%. Sample-size badges fade for low-confidence
        contributions — small numbers = honest numbers.
      </p>
    </Panel>
  );
}

function SplitBar({
  blueWinrate,
  redWinrate,
}: {
  blueWinrate: number;
  redWinrate: number;
}) {
  return (
    <div className="flex h-3 w-full rounded overflow-hidden border border-zinc-800">
      <div
        className="bg-blue-500/70"
        style={{ width: `${blueWinrate * 100}%` }}
      />
      <div
        className="bg-red-500/70"
        style={{ width: `${redWinrate * 100}%` }}
      />
    </div>
  );
}

function BreakdownRow({
  label,
  d,
  sign,
  ruleBased = false,
}: {
  label: string;
  d: WeightedDelta;
  sign: number;
  /** Composition has no sample size — render without a games badge. */
  ruleBased?: boolean;
}) {
  const value = d.value * sign;
  const conf = ruleBased ? "high" : confidenceFromGames(d.games);
  const sym = value > 0 ? "+" : "";
  const pct = `${sym}${(value * 100).toFixed(2)}%`;
  const tone =
    value > 0.002
      ? "text-emerald-400"
      : value < -0.002
      ? "text-red-400"
      : "text-zinc-500";
  return (
    <div
      className={`flex items-center justify-between gap-2 sm:gap-3 ${CONFIDENCE_OPACITY[conf]}`}
    >
      <span className={`${CONFIDENCE_TEXT[conf]} min-w-0 flex-1 truncate sm:whitespace-normal`}>
        {label}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        {!ruleBased && d.games > 0 && (
          <ConfidenceBadge games={d.games} compact />
        )}
        <span className={`font-mono ${tone} w-14 sm:w-16 text-right`}>{pct}</span>
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/40">
      {children}
    </div>
  );
}
