import PoolManager from "@/components/PoolManager";

export default function PoolPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-3 sm:p-6">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6 flex items-center justify-between">
          <a href="/" className="text-2xl font-bold tracking-tight">
            Draft<span className="text-emerald-400">Lab</span>
          </a>
          <a
            href="/draft"
            className="text-sm text-zinc-400 hover:text-zinc-200 underline"
          >
            Back to draft
          </a>
        </header>
        <PoolManager />
      </div>
    </main>
  );
}
