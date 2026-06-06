import os
import requests
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("RIOT_API_KEY")
if not api_key:
    print("ERROR: RIOT_API_KEY not found.")
    exit()

headers = {"X-Riot-Token": api_key}

# Step 1: Grab an Emerald player.
players_resp = requests.get(
    "https://na1.api.riotgames.com/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I",
    headers=headers,
    params={"page": 1}
)
puuid = players_resp.json()[0]["puuid"]

# Step 2: Get their recent match IDs.
matches_resp = requests.get(
    f"https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids",
    headers=headers,
    params={"queue": 420, "count": 20}
)
match_ids = matches_resp.json()

# Step 3: Fetch FULL details for the first match.
match_id = match_ids[0]
print(f"Fetching match {match_id}...\n")

match_resp = requests.get(
    f"https://americas.api.riotgames.com/lol/match/v5/matches/{match_id}",
    headers=headers
)

if match_resp.status_code != 200:
    print(f"Error: {match_resp.status_code}")
    print(match_resp.text)
    exit()

match = match_resp.json()

# Reach into the response and pull out the parts we care about.
info = match["info"]
patch = info["gameVersion"]
duration_minutes = info["gameDuration"] // 60
participants = info["participants"]  # list of 10 players
teams = info["teams"]                # list of 2 teams

# Print game-level info.
print(f"Patch: {patch}")
print(f"Duration: {duration_minutes} minutes\n")

# Print bans for each team.
for team in teams:
    side = "Blue" if team["teamId"] == 100 else "Red"
    bans = [b["championId"] for b in team["bans"]]
    won = "WON" if team["win"] else "lost"
    print(f"{side} side ({won}) banned championIds: {bans}")

print()

# Print picks for each side, sorted by role for readability.
role_order = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]

for side_id, side_name in [(100, "Blue"), (200, "Red")]:
    print(f"{side_name} side picks:")
    side_picks = [p for p in participants if p["teamId"] == side_id]
    side_picks.sort(
        key=lambda p: role_order.index(p["teamPosition"]) if p["teamPosition"] in role_order else 99
    )
    for p in side_picks:
        role = p["teamPosition"] or "?"
        champion = p["championName"]
        kda = f"{p['kills']}/{p['deaths']}/{p['assists']}"
        print(f"  {role:8} {champion:15} KDA: {kda}")
    print()