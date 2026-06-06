import json
import sqlite3
from collections import defaultdict
from itertools import combinations

conn = sqlite3.connect("matches.db")
cursor = conn.cursor()

# --- Storage ----------------------------------------------------------------
# Base: champion_role_stats[champion][role] = {"wins": N, "games": N}
champion_role_stats = defaultdict(lambda: defaultdict(lambda: {"wins": 0, "games": 0}))

# Matchups (asymmetric): matchup_stats[A][role_A][B][role_B] = wins/games for
# A in role_A vs B in role_B. Same-role matchups have role_A == role_B (in-lane).
# Cross-role matchups (e.g. Aphelios BOT vs Jarvan JG) have role_A != role_B.
# wins is "how many times A's team beat B's team in this pairing"
matchup_stats = defaultdict(
    lambda: defaultdict(
        lambda: defaultdict(
            lambda: defaultdict(lambda: {"wins": 0, "games": 0})
        )
    )
)

# Synergies (symmetric, stored both directions for easy lookup):
# synergy_stats[A][B] = wins/games for A and B on the same team
synergy_stats = defaultdict(lambda: defaultdict(lambda: {"wins": 0, "games": 0}))

# --- Process matches --------------------------------------------------------
cursor.execute("SELECT raw_json FROM matches WHERE queue_id = 420")

matches_processed = 0
matches_skipped = 0
participants_processed = 0

for (raw_json,) in cursor.fetchall():
    match = json.loads(raw_json)
    participants = match["info"]["participants"]

    # Drop participants without a clear role.
    valid = [p for p in participants if p.get("teamPosition")]

    # If we don't have a clean 10 players with roles, skip the whole match.
    # Half-clean matchup data would corrupt the stats.
    if len(valid) != 10:
        matches_skipped += 1
        continue

    matches_processed += 1
    participants_processed += 10

    # 1) Champion base stats
    for p in valid:
        champion = p["championName"]
        role = p["teamPosition"]
        champion_role_stats[champion][role]["games"] += 1
        if p["win"]:
            champion_role_stats[champion][role]["wins"] += 1

    # 2) Group participants by team for the pairwise computations.
    by_team = defaultdict(list)
    for p in valid:
        by_team[p["teamId"]].append(p["championName"])

    # Split valid participants into the two teams (keeping role info).
    team_ids = list(by_team.keys())
    if len(team_ids) != 2:
        continue  # corrupt teamId data
    team_a_players = [p for p in valid if p["teamId"] == team_ids[0]]
    team_b_players = [p for p in valid if p["teamId"] == team_ids[1]]

    # 3) Matchup stats — every cross-team pair (5x5 = 25 per game).
    # Same-role pairs (role_A == role_B) are the in-lane matchup.
    # Cross-role pairs (role_A != role_B) capture out-of-lane pressure,
    # e.g. an enemy jungler ganking your immobile bot laner.
    for a in team_a_players:
        for b in team_b_players:
            ac, ar = a["championName"], a["teamPosition"]
            bc, br = b["championName"], b["teamPosition"]

            matchup_stats[ac][ar][bc][br]["games"] += 1
            matchup_stats[bc][br][ac][ar]["games"] += 1
            if a["win"]:
                matchup_stats[ac][ar][bc][br]["wins"] += 1
            else:
                matchup_stats[bc][br][ac][ar]["wins"] += 1

    # 4) Synergy stats: every pair on the same team is a synergy data point.
    for team_id, champs in by_team.items():
        # Did this team win? Find any player on this team and check their win flag.
        team_won = next(p["win"] for p in valid if p["teamId"] == team_id)
        for ac, bc in combinations(champs, 2):
            synergy_stats[ac][bc]["games"] += 1
            synergy_stats[bc][ac]["games"] += 1
            if team_won:
                synergy_stats[ac][bc]["wins"] += 1
                synergy_stats[bc][ac]["wins"] += 1

# --- Flatten to list-of-records ---------------------------------------------
def winrate(wins, games):
    return round(wins / games, 4) if games > 0 else 0

champion_role_records = []
for champion, roles in champion_role_stats.items():
    for role, wl in roles.items():
        champion_role_records.append({
            "champion": champion, "role": role,
            "games": wl["games"], "wins": wl["wins"],
            "winrate": winrate(wl["wins"], wl["games"]),
        })
champion_role_records.sort(key=lambda r: -r["games"])

# Same-role matchups: keep everything with >= 1 game (these are the in-lane
# matchups, the engine considers >= 20 games meaningful).
# Cross-role matchups: prune below 10 games — they're far below the engine's
# 40-game threshold and just bloat the JSON the web app has to download.
SAME_ROLE_MIN_GAMES = 1
CROSS_ROLE_MIN_GAMES = 10

matchup_records = []
for a, a_roles in matchup_stats.items():
    for role_a, opponents in a_roles.items():
        for b, b_roles in opponents.items():
            for role_b, wl in b_roles.items():
                same_role = role_a == role_b
                min_games = SAME_ROLE_MIN_GAMES if same_role else CROSS_ROLE_MIN_GAMES
                if wl["games"] < min_games:
                    continue
                matchup_records.append({
                    "champion": a, "role": role_a,
                    "vs_champion": b, "vs_role": role_b,
                    "games": wl["games"], "wins": wl["wins"],
                    "winrate": winrate(wl["wins"], wl["games"]),
                })
matchup_records.sort(key=lambda r: -r["games"])

synergy_records = []
seen_pairs = set()
for a, partners in synergy_stats.items():
    for b, wl in partners.items():
        # A+B and B+A are the same synergy — only keep one direction.
        pair_key = tuple(sorted([a, b]))
        if pair_key in seen_pairs:
            continue
        seen_pairs.add(pair_key)
        if wl["games"] < 1:
            continue
        synergy_records.append({
            "champion_a": pair_key[0], "champion_b": pair_key[1],
            "games": wl["games"], "wins": wl["wins"],
            "winrate": winrate(wl["wins"], wl["games"]),
        })
synergy_records.sort(key=lambda r: -r["games"])

# --- Print sanity checks ----------------------------------------------------
print(f"Processed {matches_processed} matches, skipped {matches_skipped} (bad role data).")
print(f"Participants used: {participants_processed}\n")

def role_label(r):
    return r if len(r) <= 8 else r[:8]

print("=== Top 10 matchups by sample size (any role pairing) ===")
print(f"{'Champion':<14} {'Role':<8} {'vs':<3} {'Opponent':<14} {'vsRole':<8} {'Games':>5} {'WR':>7}")
print("-" * 70)
for r in matchup_records[:10]:
    print(f"{r['champion']:<14} {role_label(r['role']):<8} {'vs':<3} {r['vs_champion']:<14} {role_label(r['vs_role']):<8} {r['games']:>5} {r['winrate']*100:>6.1f}%")

print("\n=== Top 5 SAME-ROLE matchups (in-lane only) ===")
same_role = [r for r in matchup_records if r["role"] == r["vs_role"]]
for r in same_role[:5]:
    print(f"{r['champion']:<14} {role_label(r['role']):<8} {'vs':<3} {r['vs_champion']:<14} {r['games']:>5} {r['winrate']*100:>6.1f}%")

print("\n=== Top 5 CROSS-ROLE matchups (out-of-lane) ===")
cross_role = [r for r in matchup_records if r["role"] != r["vs_role"]]
for r in cross_role[:5]:
    print(f"{r['champion']:<14} {role_label(r['role']):<8} {'vs':<3} {r['vs_champion']:<14} {role_label(r['vs_role']):<8} {r['games']:>5} {r['winrate']*100:>6.1f}%")

print("\n=== Strongest in-lane matchups (min 30 games) ===")
strong_matchups = [r for r in same_role if r["games"] >= 30]
strong_matchups.sort(key=lambda r: -r["winrate"])
for r in strong_matchups[:10]:
    print(f"{r['champion']:<14} {role_label(r['role']):<8} {'vs':<3} {r['vs_champion']:<14} {r['games']:>5} {r['winrate']*100:>6.1f}%")

print("\n=== Strongest cross-role matchups (min 40 games) ===")
strong_cross = [r for r in cross_role if r["games"] >= 40]
strong_cross.sort(key=lambda r: -r["winrate"])
for r in strong_cross[:10]:
    print(f"{r['champion']:<14} {role_label(r['role']):<8} {'vs':<3} {r['vs_champion']:<14} {role_label(r['vs_role']):<8} {r['games']:>5} {r['winrate']*100:>6.1f}%")

print("\n=== Top 10 synergies by sample size ===")
print(f"{'Champion A':<15} {'+':<3} {'Champion B':<15} {'Games':>5} {'WR':>7}")
print("-" * 55)
for r in synergy_records[:10]:
    print(f"{r['champion_a']:<15} {'+':<3} {r['champion_b']:<15} {r['games']:>5} {r['winrate']*100:>6.1f}%")

print("\n=== Strongest synergies (min 50 games) ===")
strong_synergies = [r for r in synergy_records if r["games"] >= 50]
strong_synergies.sort(key=lambda r: -r["winrate"])
for r in strong_synergies[:10]:
    print(f"{r['champion_a']:<15} {'+':<3} {r['champion_b']:<15} {r['games']:>5} {r['winrate']*100:>6.1f}%")

# --- Save -------------------------------------------------------------------
output = {
    "meta": {
        "matches_processed": matches_processed,
        "matches_skipped": matches_skipped,
        "participants_processed": participants_processed,
    },
    "champion_role_stats": champion_role_records,
    "matchup_stats": matchup_records,
    "synergy_stats": synergy_records,
}

with open("stats.json", "w") as f:
    # No pretty-printing — this file is loaded by the web app, every byte
    # counts. Use jq or python -m json.tool if you need to read it by hand.
    json.dump(output, f, separators=(",", ":"))

print(f"\nWrote stats.json")
print(f"  Champion-role records: {len(champion_role_records)}")
print(f"  Matchup records:       {len(matchup_records)}")
print(f"  Synergy records:       {len(synergy_records)}")

import os
print(f"  File size:             {os.path.getsize('stats.json') / 1024:.1f} KB")

conn.close()
