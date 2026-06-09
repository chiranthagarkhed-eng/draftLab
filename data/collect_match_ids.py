import os
import time
import sqlite3
import requests  # noqa: F401 — kept for compatibility; get_with_retry wraps it
from dotenv import load_dotenv
from riot_api import get_with_retry

load_dotenv()
api_key = os.getenv("RIOT_API_KEY")
if not api_key:
    print("ERROR: RIOT_API_KEY not found.")
    exit()

headers = {"X-Riot-Token": api_key}

# --- Config -----------------------------------------------------------------
# How many players to process per run. With 1.3s sleep per call, each player
# takes ~1.3 seconds. Start with 100; scale up after the script proves out.
PLAYERS_PER_RUN = 500

# How many recent matches to grab per player.
MATCHES_PER_PLAYER = 20

# Sleep between API calls to stay under rate limits.
SLEEP_BETWEEN_REQUESTS = 1.3
# ----------------------------------------------------------------------------

conn = sqlite3.connect("matches.db")
cursor = conn.cursor()

# One-time schema migration: add a column to track which players we've processed.
# ALTER TABLE fails if the column already exists, so we wrap in try/except.
try:
    cursor.execute("ALTER TABLE players ADD COLUMN matches_fetched_at TIMESTAMP")
    conn.commit()
    print("Added matches_fetched_at column to players table.\n")
except sqlite3.OperationalError:
    pass  # Column already exists from a previous run.

# Find players we haven't processed yet, limited to PLAYERS_PER_RUN.
cursor.execute("""
    SELECT puuid FROM players
    WHERE matches_fetched_at IS NULL
    LIMIT ?
""", (PLAYERS_PER_RUN,))
unprocessed = [row[0] for row in cursor.fetchall()]

if not unprocessed:
    print("No unprocessed players found. Run collect_players.py to add more,")
    print("or all players have been processed already.")
    conn.close()
    exit()

print(f"Processing {len(unprocessed)} players...\n")

total_new = 0
total_dupes = 0

for i, puuid in enumerate(unprocessed, start=1):
    # NOTE: this is the REGIONAL host (americas), not na1 — match endpoints use it.
    url = f"https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids"
    resp = get_with_retry(
        url,
        headers=headers,
        params={"queue": 420, "count": MATCHES_PER_PLAYER},
    )

    if resp.status_code != 200:
        print(f"  [{i:>3}/{len(unprocessed)}] ERROR {resp.status_code} for {puuid[:8]}...")
        time.sleep(SLEEP_BETWEEN_REQUESTS)
        continue

    match_ids = resp.json()

    new_count = 0
    dup_count = 0

    for match_id in match_ids:
        try:
            cursor.execute("INSERT INTO match_ids (match_id) VALUES (?)", (match_id,))
            new_count += 1
        except sqlite3.IntegrityError:
            # Match ID already in DB (another player led us here too) — fine, skip.
            dup_count += 1

    # Mark this player as processed.
    cursor.execute(
        "UPDATE players SET matches_fetched_at = CURRENT_TIMESTAMP WHERE puuid = ?",
        (puuid,),
    )
    conn.commit()

    total_new += new_count
    total_dupes += dup_count

    # puuid[:8] just shows the first 8 chars — full PUUIDs are 78 chars and ugly.
    print(f"  [{i:>3}/{len(unprocessed)}] {puuid[:8]}...: +{new_count} new, {dup_count} dupes")

    time.sleep(SLEEP_BETWEEN_REQUESTS)

# --- Summary ----------------------------------------------------------------
print(f"\n--- Summary ---")
print(f"New match IDs added this run: {total_new}")
print(f"Duplicates skipped this run: {total_dupes}")

cursor.execute("SELECT COUNT(*) FROM match_ids")
total_match_ids = cursor.fetchone()[0]
print(f"Total unique match IDs in DB: {total_match_ids}")

cursor.execute("SELECT COUNT(*) FROM players WHERE matches_fetched_at IS NOT NULL")
processed = cursor.fetchone()[0]
cursor.execute("SELECT COUNT(*) FROM players")
total_players = cursor.fetchone()[0]
print(f"Players processed: {processed}/{total_players}")

conn.close()    