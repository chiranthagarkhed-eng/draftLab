import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("RIOT_API_KEY")

if not api_key:
    print("ERROR: RIOT_API_KEY not found.")
    exit()

# League entries endpoint — returns players at a specific tier/division.
# Format: /lol/league/v4/entries/{queue}/{tier}/{division}?page={page}
# Queue: RANKED_SOLO_5x5 = ranked solo/duo
# Tier: EMERALD (could also be DIAMOND, PLATINUM, etc.)
# Division: I, II, III, or IV (I is highest within a tier)
url = "https://na1.api.riotgames.com/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I"

# This endpoint paginates — page 1 returns roughly 200 entries.
# We'll start with just page 1 to see what we get.
params = {"page": 1}

headers = {"X-Riot-Token": api_key}

response = requests.get(url, headers=headers, params=params)

if response.status_code != 200:
    print(f"Error: status code {response.status_code}")
    print(response.text)
    exit()

players = response.json()

print(f"Got {len(players)} players from Emerald I, page 1.\n")

# Print the full structure of the first player so we can see what fields exist.
# json.dumps with indent=2 makes the output nicely readable.
print("Here's what one player's data looks like:\n")
print(json.dumps(players[0], indent=2))