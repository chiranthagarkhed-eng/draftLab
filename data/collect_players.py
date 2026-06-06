import os
import time
import sqlite3
import requests
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("RIOT_API_KEY")
if not api_key:
    print("ERROR: RIOT_API_KEY not found.")
    exit()

headers = {"X-Riot-Token": api_key}

# --- Config -----------------------------------------------------------------
# Which tier/divisions to crawl, and how many pages each.
# Each page returns roughly 200 players. We start small; you can scale up later
# just by bumping PAGES_PER_DIVISION.
DIVISIONS_TO_CRAWL = [
    ("EMERALD", "I"),
    ("EMERALD", "II"),
    ("EMERALD", "III"),
    ("EMERALD", "IV"),
]
PAGES_PER_DIVISION = 10

# Personal API key allows ~100 requests per 120 seconds.
# Sleeping 1.3s between requests keeps us safely under that.
SLEEP_BETWEEN_REQUESTS = 1.3
# ----------------------------------------------------------------------------

# Open the database (created in step 13).
conn = sqlite3.connect("matches.db")
cursor = conn.cursor()

total_inserted = 0
total_skipped = 0

for tier, division in DIVISIONS_TO_CRAWL:
    print(f"\nCrawling {tier} {division}...")

    for page in range(1, PAGES_PER_DIVISION + 1):
        url = f"https://na1.api.riotgames.com/lol/league/v4/entries/RANKED_SOLO_5x5/{tier}/{division}"
        resp = get_with_retry(url, headers=headers, params={"page": page})

        if resp.status_code != 200:
            print(f"  Page {page}: ERROR {resp.status_code} — {resp.text[:120]}")
            time.sleep(SLEEP_BETWEEN_REQUESTS)
            continue

        players = resp.json()
        if not players:
            print(f"  Page {page}: empty (end of division reached)")
            break

        inserted_this_page = 0
        skipped_this_page = 0

        for p in players:
            # Skip inactive players — they won't have recent match histories worth fetching.
            if p.get("inactive"):
                continue

            try:
                # Parameterized SQL (?) — never string-format user data into a query.
                cursor.execute("""
                    INSERT INTO players (puuid, tier, rank, league_points, wins, losses)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    p["puuid"], p["tier"], p["rank"],
                    p["leaguePoints"], p["wins"], p["losses"]
                ))
                inserted_this_page += 1
            except sqlite3.IntegrityError:
                # PUUID already in DB — that's fine, just skip.
                skipped_this_page += 1

        conn.commit()
        total_inserted += inserted_this_page
        total_skipped += skipped_this_page
        print(f"  Page {page}: {inserted_this_page} new, {skipped_this_page} duplicates")

        # Sleep between requests to stay under rate limits.
        time.sleep(SLEEP_BETWEEN_REQUESTS)

# --- Summary ----------------------------------------------------------------
print(f"\n--- Summary ---")
print(f"New players inserted this run: {total_inserted}")
print(f"Duplicates skipped this run: {total_skipped}")

cursor.execute("SELECT COUNT(*) FROM players")
total_in_db = cursor.fetchone()[0]
print(f"Total players in DB: {total_in_db}")

conn.close()