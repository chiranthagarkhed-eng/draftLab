"use client";

import { useEffect, useState } from "react";
import { loadStoredUserPool, type StoredUserPool } from "@/lib/data";

/**
 * Header link on /draft that reflects whether a pool is loaded.
 *  - No pool:  "Load champion pool"
 *  - Pool on:  "Pool: Sparkle#NA1 (personalized)"
 */
export default function PoolHeaderLink() {
  const [pool, setPool] = useState<StoredUserPool | null>(null);
  useEffect(() => {
    setPool(loadStoredUserPool());
  }, []);

  if (!pool) {
    return (
      <a href="/pool" className="text-sm text-zinc-400 hover:text-zinc-200 underline">
        Load champion pool
      </a>
    );
  }
  return (
    <a
      href="/pool"
      className="text-sm text-emerald-300 hover:text-emerald-200 underline"
      title="Click to refresh or clear your pool"
    >
      Pool: {pool.account.game_name}
      <span className="text-emerald-500/70">#{pool.account.tag_line}</span>{" "}
      <span className="text-[10px] uppercase tracking-wider opacity-70">
        personalized
      </span>
    </a>
  );
}
