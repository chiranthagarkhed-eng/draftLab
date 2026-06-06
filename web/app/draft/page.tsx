import { Suspense } from "react";
import DraftBoard from "@/components/DraftBoard";
import PoolHeaderLink from "@/components/PoolHeaderLink";

// DraftBoard uses useSearchParams() to hydrate state from the URL. In Next.js
// 13+ that hook needs a Suspense boundary above it, otherwise the production
// build bails out of static rendering for this route.
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
