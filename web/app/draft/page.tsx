import { Suspense } from "react";
import DraftBoard from "@/components/DraftBoard";
import PoolHeaderLink from "@/components/PoolHeaderLink";

// DraftBoard hydrates its state from window.location's search params via
// useSearchParams(). On Next.js 15/16 the production prerender pass can't
// reason about a URL it doesn't yet know, so we tell Next.js to skip
// pre-rendering this route entirely and just render it per-request. The
// page is interactive-only anyway — there's nothing to gain from SSG here.
export const dynamic = "force-dynamic";

export default function DraftPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-center justify-between">
          <a href="/" className="text-2xl font-bold tracking-tight">
            Draft<span className="text-emerald-400">Lab</span>
          </a>
          <PoolHeaderLink />
        </header>

        <Suspense
          fallback={
            <div className="text-zinc-500 text-sm">Loading draft board…</div>
          }
        >
          <DraftBoard />
        </Suspense>
      </div>
    </main>
  );
}
