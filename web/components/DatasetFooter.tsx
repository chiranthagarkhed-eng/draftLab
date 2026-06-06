"use client";

import { useEffect, useState } from "react";
import { loadDatasetMeta, type DatasetMeta } from "@/lib/data";

/**
 * Persistent footer showing patch, match count, and rank bracket — PRD FR-7.
 * Signals data freshness so users know whether they're looking at current-patch
 * recommendations.
 */
export default function DatasetFooter() {
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDatasetMeta()
      .then(setMeta)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <footer className="border-t border-zinc-800/60 bg-zinc-900/40 px-3 sm:px-4 py-2 text-[10px] sm:text-[11px] text-zinc-500 flex flex-wrap items-center justify-center gap-x-3 sm:gap-x-4 gap-y-1">
      {error && <span className="text-red-400">data unavailable</span>}
      {!meta && !error && <span className="opacity-60">loading dataset…</span>}
      {meta && (
        <>
          <FooterChip label="Patch" value={meta.patch ?? "—"} />
          <FooterChip
            label="Matches"
            value={meta.matches_processed.toLocaleString()}
          />
          <FooterChip label="Rank" value={meta.rank_bracket} />
          <FooterChip label="Region" value="NA" />
        </>
      )}
    </footer>
  );
}

function FooterChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="uppercase tracking-wider text-zinc-600">{label}</span>
      <span className="font-mono text-zinc-300">{value}</span>
    </span>
  );
}
