"use client";

/**
 * PoolManager — the user-facing surface for building and managing the
 * personal champion pool. Two modes:
 *
 *  - Empty state: shows a form for the user's Riot ID. Submit POSTs to
 *    /api/pool, which spends ~30 API calls and ~40-60s before returning
 *    the aggregated pool. We surface a clear "this takes a minute" message.
 *  - Loaded state: shows the stored pool grouped by role, with Refresh
 *    and Clear actions.
 *
 * The stored pool feeds the recommendation engine via toEnginePool().
 */

import { useEffect, useState } from "react";
import {
  ROLES,
  ROLE_LABELS,
  championDisplayName,
  championPortraitUrl,
  loadStoredUserPool,
  saveUserPool,
  clearStoredUserPool,
  type StoredUserPool,
} from "@/lib/data";

type Status = "idle" | "loading" | "error";

export default function PoolManager() {
  const [stored, setStored] = useState<StoredUserPool | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [gameName, setGameName] = useState("");
  const [tagLine, setTagLine] = useState("NA1");

  useEffect(() => {
    setStored(loadStoredUserPool());
  }, []);

  async function fetchPool(e?: React.FormEvent) {
    e?.preventDefault();
    if (!gameName.trim() || !tagLine.trim()) {
      setError("Both game name and tag are required");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const resp = await fetch("/api/pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameName: gameName.trim(), tagLine: tagLine.trim() }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      const payload = await resp.json();
      const saved = saveUserPool(payload);
      setStored(saved);
      setStatus("idle");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  function clearPool() {
    clearStoredUserPool();
    setStored(null);
    setStatus("idle");
    setError(null);
  }

  function refreshPool() {
    if (!stored) return;
    setGameName(stored.account.game_name);
    setTagLine(stored.account.tag_line);
    fetchPool();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Champion pool</h1>
        <p className="text-sm text-zinc-400">
          Connect your Riot ID and we&apos;ll pull your last 30 ranked solo
          matches to build a personalized champion pool. Your pool nudges
          DraftLab&apos;s recommendations toward picks you actually play.
        </p>
      </div>

      {status === "loading" ? (
        <LoadingPanel />
      ) : stored ? (
        <PoolDisplay
          stored={stored}
          onRefresh={refreshPool}
          onClear={clearPool}
        />
      ) : (
        <PoolForm
          gameName={gameName}
          tagLine={tagLine}
          onGameNameChange={setGameName}
          onTagLineChange={setTagLine}
          onSubmit={fetchPool}
          error={status === "error" ? error : null}
        />
      )}
    </div>
  );
}

function PoolForm({
  gameName,
  tagLine,
  onGameNameChange,
  onTagLineChange,
  onSubmit,
  error,
}: {
  gameName: string;
  tagLine: string;
  onGameNameChange: (v: string) => void;
  onTagLineChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  error: string | null;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/40 space-y-4"
    >
      <div>
        <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1">
          Riot ID
        </label>
        <div className="flex gap-2 items-center">
          <input
            value={gameName}
            onChange={(e) => onGameNameChange(e.target.value)}
            placeholder="Sparkle"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-500"
            autoFocus
          />
          <span className="text-zinc-500 text-lg">#</span>
          <input
            value={tagLine}
            onChange={(e) => onTagLineChange(e.target.value)}
            placeholder="NA1"
            className="w-20 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-500"
          />
        </div>
        <p className="text-[10px] text-zinc-500 mt-1">
          The part before # is your name; the part after is your region tag
          (NA1 for most North America accounts).
        </p>
      </div>

      <button
        type="submit"
        className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-300 text-sm font-medium rounded transition"
      >
        Build my pool
      </button>

      <p className="text-[11px] text-zinc-500">
        Heads up: this takes about a minute. We analyze 30 of your recent
        ranked solo games, one API call each, paced to stay under Riot&apos;s
        rate limits.
      </p>

      {error && (
        <div className="border border-red-900/60 bg-red-950/30 rounded p-3 text-sm text-red-300">
          {error}
        </div>
      )}
    </form>
  );
}

function LoadingPanel() {
  return (
    <div className="border border-zinc-800 rounded-lg p-6 bg-zinc-900/40 text-center">
      <div className="text-emerald-400 text-sm uppercase tracking-wider mb-2">
        Analyzing your matches
      </div>
      <div className="text-zinc-300 text-sm mb-1">
        This takes about a minute — don&apos;t close this tab.
      </div>
      <div className="text-[11px] text-zinc-500">
        Fetching 30 matches at ~1.3s each, then aggregating your picks by role.
      </div>
      <div className="mt-4 inline-block w-6 h-6 border-2 border-emerald-500/40 border-t-emerald-400 rounded-full animate-spin" />
    </div>
  );
}

function PoolDisplay({
  stored,
  onRefresh,
  onClear,
}: {
  stored: StoredUserPool;
  onRefresh: () => void;
  onClear: () => void;
}) {
  const fetchedAt = new Date(stored.fetched_at);
  const ageHours = (Date.now() - fetchedAt.getTime()) / (1000 * 60 * 60);
  const ageLabel =
    ageHours < 1
      ? `${Math.round(ageHours * 60)} min ago`
      : ageHours < 24
      ? `${Math.round(ageHours)} hr ago`
      : `${Math.round(ageHours / 24)} days ago`;

  return (
    <div className="space-y-4">
      <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/40 flex flex-wrap items-center gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Active pool
          </div>
          <div className="font-mono text-zinc-100">
            {stored.account.game_name}
            <span className="text-zinc-500">#{stored.account.tag_line}</span>
          </div>
          <div className="text-[11px] text-zinc-500">
            {stored.matches_analyzed} matches analyzed · refreshed {ageLabel}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={onRefresh}
            className="px-3 py-1.5 text-xs text-emerald-300 border border-emerald-700/60 hover:bg-emerald-500/10 rounded transition"
          >
            Refresh
          </button>
          <button
            onClick={onClear}
            className="px-3 py-1.5 text-xs text-zinc-400 border border-zinc-700 hover:bg-zinc-800 rounded transition"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="grid gap-3">
        {ROLES.map((role) => {
          const entries = stored.pool[role];
          if (!entries || entries.length === 0) return null;
          const totalGames = entries.reduce((s, e) => s + e.games, 0);
          return (
            <div
              key={role}
              className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/40"
            >
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald-400">
                  {ROLE_LABELS[role]}
                </h3>
                <span className="text-[10px] text-zinc-500">
                  {totalGames} games
                </span>
              </div>
              <ul className="space-y-1">
                {entries.map((e) => (
                  <li
                    key={e.champion}
                    className="flex items-center gap-3 text-sm"
                  >
                    <img
                      src={championPortraitUrl(e.champion)}
                      alt={championDisplayName(e.champion)}
                      className="w-8 h-8 rounded"
                      onError={(ev) => {
                        (ev.currentTarget as HTMLImageElement).style.opacity = "0.3";
                      }}
                    />
                    <span className="flex-1 font-medium">
                      {championDisplayName(e.champion)}
                    </span>
                    <span className="font-mono text-xs text-zinc-500 w-12 text-right">
                      {e.games}g
                    </span>
                    <span
                      className={`font-mono text-xs w-14 text-right ${
                        e.winrate >= 0.55
                          ? "text-emerald-400"
                          : e.winrate >= 0.5
                          ? "text-zinc-300"
                          : "text-red-400"
                      }`}
                    >
                      {(e.winrate * 100).toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <a
        href="/draft"
        className="block text-center px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-300 text-sm font-medium rounded transition"
      >
        Back to draft → recommendations are now personalized
      </a>
    </div>
  );
}
