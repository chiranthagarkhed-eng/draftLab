/**
 * Small persistent disclaimer required by Riot Games legal policy
 * for third-party tools that use their data. Per PRD FR-11.
 */
export default function RiotDisclaimer() {
  return (
    <div className="border-b border-zinc-800/60 bg-zinc-900/40 text-[10px] sm:text-[11px] text-zinc-500 px-3 sm:px-4 py-1.5 text-center leading-snug">
      DraftLab isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the
      views or opinions of Riot Games or anyone officially involved in producing
      or managing League of Legends. League of Legends and Riot Games are
      trademarks or registered trademarks of Riot Games, Inc.
    </div>
  );
}
