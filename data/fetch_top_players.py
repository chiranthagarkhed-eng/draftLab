import os
import requests
from dotenv import load_dotenv


# Load the .env file. This reads RIOT_API_KEY into the environment.
load_dotenv()

# Pull the key out of the environment into a variable.
api_key = os.getenv("RIOT_API_KEY")

# Safety check — bail out early if the key isn't there.
if not api_key:
    print("ERROR: RIOT_API_KEY not found. Check your .env file.")
    exit()

url = "https://na1.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5"

headers = {"X-Riot-Token": api_key}

response = requests.get(url, headers=headers)

if response.status_code != 200:
    print(f"Error: status code {response.status_code}")
    print(response.text)
    exit()

data = response.json()

entries = data["entries"]

entries.sort(key=lambda x: x["leaguePoints"], reverse=True)

print(f"Top 5 NA Challenger players right now:\n")
for i, entry in enumerate(entries[:5], start=1):
    print(f"{i}. {entry['leaguePoints']} LP — {entry['wins']}W / {entry['losses']}L")