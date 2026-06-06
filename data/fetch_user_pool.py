import os
import json
import time
import requests
from collections import defaultdict
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("RIOT_API_KEY")
if not api_key:
    print("ERROR: RIOT_API_KEY not found.")
    exit()

headers = {"X-Riot-Token": api_key}

# --- Config ----------------------------------------------------------------
MATCHES_TO_ANALYZE = 50      # How many recent ranked solo games to look at
SLEEP_BETWEEN_REQUESTS = 1.3 # Rate limit
# ----------------------------------------------------------------------------

# --- Interactive prompt for the user's Riot ID ----------------------------
print("Enter your Riot ID. Example: Sparkle#NA1")
game_name = input("  Game name (the part before #): ").strip()
tag_line  = input("  Tag (the part after #, e.g. NA1): ").strip()
print()

# --- Step 1: Resolve Riot ID -> PUUID --------------------------------------
# Account endpoint uses REGIONAL routing — americas for NA, LAN, BR, OCE.
account_url = f"https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{game_name}/{tag_line}"
resp = requests.get(account_url, headers=headers)
if resp.status_code != 200:
    print(f"Couldn't find that Riot ID. Status {resp.status_code}")
    print(resp.text)
    exit()

account = resp.json()
puuid = account["puuid"]
print(f"Found: {account['gameName']}#{account['tagLine']}")
print(f"PUUID: {puuid[:16]}...\n")

# --- Step 2: Get recent ranked solo match IDs ------------------------------
match_ids_url = f"https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids"
resp = requests.get(match_ids_url, headers=headers,
                    params={"queue": 420, "count": MATCHES_TO_ANALYZE})
if resp.status_code != 200:
    print(f"Couldn't fetch match history. Status {resp.status_code}")
    exit()

match_ids = resp.json()
if not match_ids:
    print("No ranked solo matches found for this account.")
    exit()

print(f"Found {len(match_ids)} recent ranked solo matches. Analyzing...\n")

# --- Step 3: For each match, find this player's pick and outcome ----------
# pool_data[role][champion] = {"games": N, "wins": N}
pool_data = defaultdict(lambda: defaultdict(lambda: {"games": 0, "wins": 0}))

for i, match_id in enumerate(match_ids, start=1):
    match_url = f"https://americas.api.riotgames.com/lol/match/v5/matches/{match_id}"
    r = requests.get(match_url, headers=headers)
    if r.status_code != 200:
        time.sleep(SLEEP_BETWEEN_REQUESTS)
        continue

    match = r.json()
    # Find this player in the participants list.
    for p in match["info"]["participants"]:
        if p["puuid"] == puuid:
            role = p.get("teamPosition", "")
            if not role:
                continue
            champ = p["championName"]
            pool_data[role][champ]["games"] += 1
            if p["win"]:
                pool_data[role][champ]["wins"] += 1
            break

    if i % 10 == 0:
        print(f"  [{i}/{len(match_ids)}]")
    time.sleep(SLEEP_BETWEEN_REQUESTS)

# --- Step 4: Build the pool — top champions per role ----------------------
print("\n=== Your Champion Pool ===\n")
pool_output = {}
for role in ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]:
    if role not in pool_data:
        continue
    champs = pool_data[role]
    # Sort by games played, most played first.
    sorted_champs = sorted(champs.items(), key=lambda x: -x[1]["games"])

    total_games = sum(s["games"] for _, s in sorted_champs)
    print(f"{role} ({total_games} games):")

    pool_output[role] = []
    for champ, stats in sorted_champs:
        wr = (stats["wins"] / stats["games"] * 100) if stats["games"] > 0 else 0
        print(f"  {champ:<18} {stats['games']:>3} games   {wr:>5.1f}% WR")
        pool_output[role].append({
            "champion": champ,
            "games": stats["games"],
            "wins": stats["wins"],
            "winrate": round(stats["wins"] / stats["games"], 4) if stats["games"] > 0 else 0,
        })
    print()

# --- Step 5: Save ---------------------------------------------------------
output = {
    "account": {
        "game_name": account["gameName"],
        "tag_line": account["tagLine"],
        "puuid": puuid,
    },
    "matches_analyzed": len(match_ids),
    "pool": pool_output,
}
with open("user_pool.json", "w") as f:
    json.dump(output, f, indent=2)

print(f"Wrote user_pool.json")