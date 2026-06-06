export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <section className="flex-1 flex flex-col items-center justify-center px-6 text-center py-20">
        <h1 className="text-5xl sm:text-7xl font-bold tracking-tight mb-6">
          Draft<span className="text-emerald-400">Lab</span>
        </h1>
        <p className="text-xl sm:text-2xl text-zinc-300 max-w-2xl mb-4">
          Honest draft recommendations for solo queue.
        </p>
        <p className="text-base text-zinc-400 max-w-xl mb-10">
          Personalized to your champion pool. Scored on matchups, synergies, and team composition. Confidence shown, no fake precision.
        </p>

        <a
          href="/draft"
          className="inline-block px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold rounded-lg transition"
        >
          Start a draft
        </a>

        <a
          href="/pool"
          className="mt-4 text-sm text-zinc-400 hover:text-zinc-200 underline"
        >
          or load your champion pool first
        </a>
      </section>

      <section className="border-t border-zinc-800 px-6 py-12">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8">
          <div>
            <h3 className="font-semibold text-emerald-400 mb-2">Personalized</h3>
            <p className="text-sm text-zinc-400">
              Recommendations weighted by champions you actually play, not just the global meta.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-emerald-400 mb-2">Team-aware</h3>
            <p className="text-sm text-zinc-400">
              Scores in-lane matchups, pairwise synergies, and full team composition: frontline, damage mix, range balance.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-emerald-400 mb-2">Honest about uncertainty</h3>
            <p className="text-sm text-zinc-400">
              Small sample sizes get shrunk toward zero. You always see how many games a number is based on.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-800 px-6 py-6 text-xs text-zinc-500 text-center">
        <p className="max-w-3xl mx-auto">
          DraftLab isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing League of Legends. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.
        </p>
      </footer>
    </main>
  );
}
  