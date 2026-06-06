"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Role, DraftSlot } from "@/lib/engine";
import {
  decodeDraftState,
  encodeDraftState,
  emptyTeam as urlEmptyTeam,
  emptyBans as urlEmptyBans,
} from "@/lib/urlState";
import {
  ROLES,
  ROLE_LABELS,
  championDisplayName,
  championPortraitUrl,
  loadStoredUserPool,
  toEnginePool,
  type StoredUserPool,
} from "@/lib/data";
import ChampionPicker from "./ChampionPicker";
import MatchupAnalysis from "./MatchupAnalysis";
import Recommendations from "./Recommendations";

type Side = "blue" | "red";

// Active selection — either a pick slot (has a role) or a ban slot (has an
// index 0..4). The picker modal opens for whichever is set.
export type ActiveSlot =
  | { kind: "pick"; side: Side; role: Role }
  | { kind: "ban"; side: Side; index: number };

const BANS_PER_SIDE = 5;

// Re-export the urlState helpers so existing call-sites (clearAll) keep
// working with the same names.
const emptyTeam = urlEmptyTeam;
const emptyBans = urlEmptyBans;

export default function DraftBoard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize state from the URL once on first render. The decoder is
  // forgiving — missing params yield empty defaults. After this we
  // unidirectionally push state back to the URL (router.replace) so the URL
  // always reflects the current draft and any reload preserves the state.
  const initial = useMemo(
    () =>
      decodeDraftState(
        new URLSearchParams(searchParams?.toString() ?? "")
      ),
    // We only want the URL read once, on mount. Subsequent state updates
    // come from user interactions, not URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [blueTeam, setBlueTeam] = useState<DraftSlot[]>(initial.blueTeam);
  const [redTeam, setRedTeam] = useState<DraftSlot[]>(initial.redTeam);
  const [blueBans, setBlueBans] = useState<(string | null)[]>(initial.blueBans);
  const [redBans, setRedBans] = useState<(string | null)[]>(initial.redBans);
  const [active, setActive] = useState<ActiveSlot | null>(null);

  const [userSide, setUserSide] = useState<Side>(initial.userSide);
  const [userRole, setUserRole] = useState<Role>(initial.userRole);

  // Push state back to the URL on any change. router.replace (not push) so
  // we don't spam browser history with every click. Guarded against the
  // very first render so we don't overwrite an empty URL with itself.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    const params = encodeDraftState({
      blueTeam,
      redTeam,
      blueBans,
      redBans,
      userSide,
      userRole,
    });
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "/draft", { scroll: false });
  }, [blueTeam, redTeam, blueBans, redBans, userSide, userRole, router]);

  // Personal champion pool loaded from localStorage (set via /pool).
  // Fed into Recommendations to nudge the score toward champs the user plays.
  const [storedPool, setStoredPool] = useState<StoredUserPool | null>(null);
  useEffect(() => {
    setStoredPool(loadStoredUserPool());
  }, []);
  const userPool = useMemo(() => toEnginePool(storedPool), [storedPool]);

  function setChampion(side: Side, role: Role, champion: string | null) {
    const setter = side === "blue" ? setBlueTeam : setRedTeam;
    setter((team) =>
      team.map((s) => (s.role === role ? { ...s, champion } : s))
    );
  }

  function setBan(side: Side, index: number, champion: string | null) {
    const setter = side === "blue" ? setBlueBans : setRedBans;
    setter((bans) => bans.map((b, i) => (i === index ? champion : b)));
  }

  function clearAll() {
    setBlueTeam(emptyTeam());
    setRedTeam(emptyTeam());
    setBlueBans(emptyBans());
    setRedBans(emptyBans());
    setActive(null);
  }

  // Every champion across both teams' picks AND both teams' bans is unavailable
  // for picking again or being recommended.
  const excludedChampions = useMemo(() => {
    const s = new Set<string>();
    [...blueTeam, ...redTeam].forEach((slot) => {
      if (slot.champion) s.add(slot.champion);
    });
    [...blueBans, ...redBans].forEach((c) => {
      if (c) s.add(c);
    });
    return s;
  }, [blueTeam, redTeam, blueBans, redBans]);

  // Bans-only set for the engine — picks already flow through the team args.
  const bannedChampions = useMemo(() => {
    const s = new Set<string>();
    [...blueBans, ...redBans].forEach((c) => {
      if (c) s.add(c);
    });
    return s;
  }, [blueBans, redBans]);

  function handlePick(champion: string) {
    if (!active) return;
    if (active.kind === "pick") {
      setChampion(active.side, active.role, champion);
    } else {
      setBan(active.side, active.index, champion);
    }
    setActive(null);
  }

  function handleRecommendationPick(champion: string) {
    setChampion(userSide, userRole, champion);
  }

  const allyTeam = userSide === "blue" ? blueTeam : redTeam;
  const enemyTeam = userSide === "blue" ? redTeam : blueTeam;

  return (
    <div>
      <div className="mb-4 p-3 border border-zinc-800 rounded-lg bg-zinc-900/40 flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-4">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="text-[10px] sm:text-xs text-zinc-500 uppercase tracking-wider">
            <span className="sm:hidden">Side</span>
            <span className="hidden sm:inline">You are</span>
          </span>
          <SideToggle value={userSide} onChange={setUserSide} />
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="text-[10px] sm:text-xs text-zinc-500 uppercase tracking-wider">
            <span className="sm:hidden">Role</span>
            <span className="hidden sm:inline">Picking</span>
          </span>
          <RoleSelect value={userRole} onChange={setUserRole} />
        </div>
        <CopyLinkButton />
        <button
          onClick={clearAll}
          className="text-xs text-zinc-400 hover:text-zinc-200 underline"
        >
          Clear board
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <TeamPanel
          side="blue"
          team={blueTeam}
          bans={blueBans}
          active={active}
          onSlotClick={(role) => setActive({ kind: "pick", side: "blue", role })}
          onSlotClear={(role) => setChampion("blue", role, null)}
          onBanClick={(index) => setActive({ kind: "ban", side: "blue", index })}
          onBanClear={(index) => setBan("blue", index, null)}
        />
        <TeamPanel
          side="red"
          team={redTeam}
          bans={redBans}
          active={active}
          onSlotClick={(role) => setActive({ kind: "pick", side: "red", role })}
          onSlotClear={(role) => setChampion("red", role, null)}
          onBanClick={(index) => setActive({ kind: "ban", side: "red", index })}
          onBanClear={(index) => setBan("red", index, null)}
        />
      </div>

      <div className="mb-6">
        <MatchupAnalysis
          blueTeam={blueTeam}
          redTeam={redTeam}
          userSide={userSide}
        />
      </div>

      <Recommendations
        allyTeam={allyTeam}
        enemyTeam={enemyTeam}
        role={userRole}
        onSelect={handleRecommendationPick}
        bannedChampions={bannedChampions}
        userPool={userPool}
      />

      {active && (
        <ChampionPicker
          excludedChampions={excludedChampions}
          slotLabel={pickerLabel(active)}
          onPick={handlePick}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

function SideToggle({
  value,
  onChange,
}: {
  value: Side;
  onChange: (v: Side) => void;
}) {
  return (
    <div className="inline-flex rounded border border-zinc-700 overflow-hidden">
      <button
        onClick={() => onChange("blue")}
        className={`px-3 py-1 text-xs font-medium transition ${
          value === "blue"
            ? "bg-blue-500/20 text-blue-300"
            : "text-zinc-400 hover:text-zinc-200"
        }`}
      >
        Blue
      </button>
      <button
        onClick={() => onChange("red")}
        className={`px-3 py-1 text-xs font-medium transition ${
          value === "red"
            ? "bg-red-500/20 text-red-300"
            : "text-zinc-400 hover:text-zinc-200"
        }`}
      >
        Red
      </button>
    </div>
  );
}

const ROLE_SHORT: Record<Role, string> = {
  TOP: "T",
  JUNGLE: "J",
  MIDDLE: "M",
  BOTTOM: "B",
  UTILITY: "S",
};

function RoleSelect({
  value,
  onChange,
}: {
  value: Role;
  onChange: (v: Role) => void;
}) {
  return (
    <div className="inline-flex rounded border border-zinc-700 overflow-hidden">
      {ROLES.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`px-2 sm:px-3 py-1 text-xs font-medium transition ${
            value === r
              ? "bg-emerald-500/20 text-emerald-300"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
          aria-label={ROLE_LABELS[r]}
        >
          <span className="sm:hidden">{ROLE_SHORT[r]}</span>
          <span className="hidden sm:inline">{ROLE_LABELS[r]}</span>
        </button>
      ))}
    </div>
  );
}

interface TeamPanelProps {
  side: Side;
  team: DraftSlot[];
  bans: (string | null)[];
  active: ActiveSlot | null;
  onSlotClick: (role: Role) => void;
  onSlotClear: (role: Role) => void;
  onBanClick: (index: number) => void;
  onBanClear: (index: number) => void;
}

function TeamPanel({
  side,
  team,
  bans,
  active,
  onSlotClick,
  onSlotClear,
  onBanClick,
  onBanClear,
}: TeamPanelProps) {
  const accent =
    side === "blue"
      ? "text-blue-400 border-blue-900/40"
      : "text-red-400 border-red-900/40";
  const label = side === "blue" ? "Blue side" : "Red side";

  return (
    <div className={`border ${accent} rounded-lg p-4 bg-zinc-900/40`}>
      <h3 className={`text-sm font-semibold uppercase tracking-wider mb-3 ${accent}`}>
        {label}
      </h3>

      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
          Bans
        </div>
        <div className="flex gap-1.5">
          {bans.map((banned, i) => {
            const isActive =
              active?.kind === "ban" &&
              active.side === side &&
              active.index === i;
            return (
              <BanSlot
                key={i}
                champion={banned}
                isActive={isActive}
                onClick={() => onBanClick(i)}
                onClear={() => onBanClear(i)}
              />
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        {team.map((slot) => {
          const isActive =
            active?.kind === "pick" &&
            active.side === side &&
            active.role === slot.role;
          return (
            <SlotRow
              key={slot.role}
              slot={slot}
              isActive={isActive}
              onClick={() => onSlotClick(slot.role)}
              onClear={() => onSlotClear(slot.role)}
            />
          );
        })}
      </div>
    </div>
  );
}

function BanSlot({
  champion,
  isActive,
  onClick,
  onClear,
}: {
  champion: string | null;
  isActive: boolean;
  onClick: () => void;
  onClear: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={champion ? `Banned: ${championDisplayName(champion)}` : "Click to ban"}
      className={`relative w-8 h-8 rounded border transition shrink-0 ${
        isActive
          ? "border-emerald-500 bg-emerald-500/10"
          : champion
          ? "border-zinc-700"
          : "border-dashed border-zinc-700 hover:border-zinc-500"
      }`}
    >
      {champion ? (
        <>
          <img
            src={championPortraitUrl(champion)}
            alt={championDisplayName(champion)}
            className="w-full h-full rounded grayscale opacity-60"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <span className="block w-[140%] h-[2px] bg-red-500/80 rotate-45" />
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onClear();
              }
            }}
            className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-zinc-900 border border-zinc-700 text-[9px] leading-[10px] text-zinc-400 hover:text-red-400 hover:border-red-500 flex items-center justify-center"
            aria-label="Clear ban"
          >
            ×
          </span>
        </>
      ) : null}
    </button>
  );
}

function pickerLabel(active: ActiveSlot): string {
  const sideLabel = active.side === "blue" ? "Blue" : "Red";
  if (active.kind === "pick") {
    return `${sideLabel} ${ROLE_LABELS[active.role]}`;
  }
  return `${sideLabel} ban #${active.index + 1}`;
}

interface SlotRowProps {
  slot: DraftSlot;
  isActive: boolean;
  onClick: () => void;
  onClear: () => void;
}

function SlotRow({ slot, isActive, onClick, onClear }: SlotRowProps) {
  const filled = slot.champion !== null;

  return (
    <div
      className={`flex items-center gap-3 p-2 rounded border transition ${
        isActive
          ? "border-emerald-500 bg-emerald-500/10"
          : "border-zinc-800 hover:border-zinc-600 cursor-pointer"
      }`}
      onClick={onClick}
    >
      <div className="w-16 text-xs uppercase tracking-wider text-zinc-500">
        {ROLE_LABELS[slot.role]}
      </div>

      {filled ? (
        <img
          src={championPortraitUrl(slot.champion!)}
          alt={championDisplayName(slot.champion!)}
          className="w-10 h-10 rounded"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className="w-10 h-10 rounded bg-zinc-800 border border-dashed border-zinc-700" />
      )}

      <div className="flex-1 text-sm">
        {filled ? (
          <span className="font-medium">
            {championDisplayName(slot.champion!)}
          </span>
        ) : (
          <span className="text-zinc-500 italic">Empty — click to pick</span>
        )}
      </div>

      {filled && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="text-xs text-zinc-500 hover:text-red-400 px-2"
          aria-label="Clear slot"
        >
          ×
        </button>
      )}
    </div>
  );
}


function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        if (typeof window === "undefined") return;
        navigator.clipboard
          .writeText(window.location.href)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => {
            // Browser blocked it — surface in console; we don't need a toast.
            console.warn("Clipboard write blocked");
          });
      }}
      className={`ml-auto text-xs underline transition ${
        copied
          ? "text-emerald-400"
          : "text-zinc-400 hover:text-zinc-200"
      }`}
      title="Copy the URL — anyone with the link will see this exact draft"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
