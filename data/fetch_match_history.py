import os
import requests
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("RIOT_API_KEY")
if not api_key:
    print("ERROR: RIOT_API_KEY not found.")
    exit()

headers = {"X-Riot-Token": api_key}

# Step 1: Grab one Emerald player so we have a PUUID to work with.
players_url = "https://na1.api.riotgames.com/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I"
players_resp = requests.get(players_url, headers=headers, params={"page": 1})

if players_resp.status_code != 200:
    print(f"Error fetching players: {players_resp.status_code}")
    print(players_resp.text)
    exit()

players = players_resp.json()
puuid = players[0]["puuid"]
print(f"Picked player PUUID: {puuid}\n")

# Step 2: Use that PUUID to fetch their last 20 ranked solo matches.
# NOTE: this endpoint is on the REGIONAL host (americas), not na1.
matches_url = f"https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids"

params = {
    "queue": 420,   # 420 is the queue ID for Ranked Solo/Duo (5v5 Summoner's Rift).
    "count": 20,    # Get the most recent 20 matches.
    "start": 0,     # Start from the most recent match.
}

matches_resp = requests.get(matches_url, headers=headers, params=params)

if matches_resp.status_code != 200:
    print(f"Error fetching matches: {matches_resp.status_code}")
    print(matches_resp.text)
    exit()

match_ids = matches_resp.json()

print(f"Got {len(match_ids)} match IDs for this player:\n")
for match_id in match_ids:
    print(f"  {match_id}")