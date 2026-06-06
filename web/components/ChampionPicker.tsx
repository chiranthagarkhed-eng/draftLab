"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChampionMeta } from "@/lib/engine";
import {
  championDisplayName,
  championMatchesQuery,
  championPortraitUrl,
  listAllChampions,
  loadChampionMeta,
} from "@/lib/data";

interface ChampionPickerProps {
  excludedChampions: Set<string>;
  onPick: (champion: string) => void;
  onClose: () => void;
  slotLabel: string;
}

export default function ChampionPicker({
  excludedChampions,
  onPick,
  onClose,
  slotLabel,
}: ChampionPickerProps) {
  const [meta, setMeta] = useState<ChampionMeta | null>(null);
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadChampionMeta()
      .then(setMeta)
      .catch((e) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Filter against both internal name (MonkeyKing) and display name (Wukong)
  const filteredChampions = useMemo(() => {
    if (!meta) return [];
    const all = listAllChampions(meta);
    return all
      .filter((c) => !excludedChampions.has(c))
      .filter((c) => championMatchesQuery(c, query));
  }, [meta, query, excludedChampions]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-3xl max-h-[92vh] sm:max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div>
            <h2 className="text-lg font-semibold">Pick a champion</h2>
            <p className="text-xs text-zinc-500">{slotLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-2xl leading-none w-9 h-9 flex items-center justify-center rounded hover:bg-zinc-800"
            aria-label="Close picker"
          >
            ✕
          </button>
        </div>

        <div className="p-4 border-b border-zinc-800">
          <input
            autoFocus
            type="text"
            placeholder="Search champion..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loadError && (
            <p className="text-red-400 text-sm">
              Failed to load champion list: {loadError}
            </p>
          )}
          {!meta && !loadError && (
            <p className="text-zinc-500 text-sm">Loading champions...</p>
          )}
          {meta && filteredChampions.length === 0 && (
            <p className="text-zinc-500 text-sm italic">No matches.</p>
          )}
          {meta && filteredChampions.length > 0 && (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5 sm:gap-2">
              {filteredChampions.map((c) => (
                <button
                  key={c}
                  onClick={() => onPick(c)}
                  className="flex flex-col items-center gap-1 p-2 rounded hover:bg-zinc-800 transition group"
                >
                  <img
                    src={championPortraitUrl(c)}
                    alt={championDisplayName(c)}
                    className="w-12 h-12 rounded border border-zinc-700 group-hover:border-emerald-500 transition"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.opacity =
                        "0.3";
                    }}
                  />
                  <span className="text-[10px] text-zinc-400 text-center leading-tight truncate w-full">
                    {championDisplayName(c)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
