"use client";

/**
 * useCommentary — fetch and stream coaching commentary for a single
 * recommendation, with caching and debouncing.
 *
 * Why a custom hook:
 *   - We're calling an LLM. The PRD caps cost at ~$0.02/session. Naive
 *     eager generation on every draft change would blow that budget.
 *   - The fix is twofold: cache identical (champion, role, draft state)
 *     requests so we never bill twice, and debounce 400ms so rapid clicks
 *     don't fire a flurry of calls before the user settles on a state.
 *   - We also need to ABORT in-flight streams when the draft changes mid-
 *     stream — otherwise we keep paying for tokens the user will never see.
 *
 * Status states:
 *   "idle"      — nothing requested yet
 *   "loading"   — waiting on the server (debounce or HTTP roundtrip)
 *   "streaming" — tokens arriving
 *   "done"      — final text in place
 *   "error"     — failed; component should fall back to structured breakdown
 *   "disabled"  — server returned 503 (no API key); same fallback as error
 */

import { useEffect, useRef, useState } from "react";
import type { CommentaryRequest } from "@/app/api/commentary/route";

export type CommentaryStatus =
  | "idle"
  | "loading"
  | "streaming"
  | "done"
  | "error"
  | "disabled";

interface CacheEntry {
  text: string;
  status: "done" | "error" | "disabled";
}

const cache = new Map<string, CacheEntry>();
const DEBOUNCE_MS = 400;

/**
 * Stable signature for caching. The same recommendation under the same
 * draft state should always hit the same cache entry.
 */
function signatureOf(req: CommentaryRequest): string {
  const allies = [...req.ally_picks]
    .map((p) => `${p.role}:${p.champion}`)
    .sort()
    .join(",");
  const enemies = [...req.enemy_picks]
    .map((p) => `${p.role}:${p.champion}`)
    .sort()
    .join(",");
  return `${req.champion}|${req.role}|${allies}|${enemies}`;
}

export interface UseCommentaryResult {
  text: string;
  status: CommentaryStatus;
}

export function useCommentary(
  req: CommentaryRequest | null,
  enabled = true
): UseCommentaryResult {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<CommentaryStatus>("idle");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !req) {
      setText("");
      setStatus("idle");
      return;
    }

    const sig = signatureOf(req);
    const cached = cache.get(sig);
    if (cached) {
      setText(cached.text);
      setStatus(cached.status);
      return;
    }

    setStatus("loading");
    setText("");

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      void streamCommentary(req, controller.signal, sig, setText, setStatus);
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req ? signatureOf(req) : null, enabled]);

  return { text, status };
}

async function streamCommentary(
  req: CommentaryRequest,
  signal: AbortSignal,
  sig: string,
  setText: (s: string) => void,
  setStatus: (s: CommentaryStatus) => void
) {
  try {
    const resp = await fetch("/api/commentary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });

    if (resp.status === 503) {
      // No API key configured — caller falls back to structured breakdown.
      cache.set(sig, { text: "", status: "disabled" });
      setStatus("disabled");
      return;
    }
    if (!resp.ok || !resp.body) {
      cache.set(sig, { text: "", status: "error" });
      setStatus("error");
      return;
    }

    setStatus("streaming");
    let accumulated = "";
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";

    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });

      // Anthropic SSE: events separated by \n\n, each line "event:" or "data:".
      const chunks = pending.split("\n\n");
      pending = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const dataLine = chunk
          .split("\n")
          .find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        const json = dataLine.slice("data: ".length).trim();
        if (!json || json === "[DONE]") continue;
        try {
          const evt = JSON.parse(json);
          if (
            evt.type === "content_block_delta" &&
            evt.delta?.type === "text_delta" &&
            typeof evt.delta.text === "string"
          ) {
            accumulated += evt.delta.text;
            setText(accumulated);
          }
        } catch {
          // Ignore malformed event; keep streaming.
        }
      }
    }

    if (!signal.aborted) {
      cache.set(sig, { text: accumulated.trim(), status: "done" });
      setText(accumulated.trim());
      setStatus("done");
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    cache.set(sig, { text: "", status: "error" });
    setStatus("error");
  }
}

/** Test/debug helper — clears the cache. Not used by app code. */
export function _clearCommentaryCache() {
  cache.clear();
}
