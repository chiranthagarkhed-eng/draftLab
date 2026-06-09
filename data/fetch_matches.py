import os
import time
import json
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
# How many matches to fetch per run. Each match is 1 API call (~1.3s with sleep).
# 100 matches = ~2 min 10 sec. Scale up after the script proves out.
MATCHES_PER_RUN = 1000

SLEEP_BETWEEN_REQUESTS = 1.3
# ----------------------------------------------------------------------------

conn = sqlite3.connect("matches.db")
cursor = conn.cursor()

# Find match IDs we haven't fetched yet.
cursor.execute("""
    SELECT match_id FROM match_ids
    WHERE fetched = 0
    LIMIT ?
""", (MATCHES_PER_RUN,))
unfetched = [row[0] for row in cursor.fetchall()]

if not unfetched:
    print("No unfetched match IDs found. Run collect_match_ids.py to add more,")
    print("or all match IDs have been fetched already.")
    conn.close()
    exit()

print(f"Fetching {len(unfetched)} match details...\n")

successes = 0
errors = 0

for i, match_id in enumerate(unfetched, start=1):
    # Match details endpoint — REGIONAL host.
    url = f"https://americas.api.riotgames.com/lol/match/v5/matches/{match_id}"
    resp = get_with_retry(url, headers=headers)

    if resp.status_code != 200:
        print(f"  [{i:>3}/{len(unfetched)}] {match_id}: ERROR {resp.status_code}")
        errors += 1
        # Only mark permanently fetched on 404/410 (match truly gone). For
        # 5xx and 403 we leave fetched=0 so the next pipeline run retries.
        # (429 never gets here — riot_api handles that internally.)
        if resp.status_code in (404, 410):
            cursor.execute(
                "UPDATE match_ids SET fetched = 1 WHERE match_id = ?",
                (match_id,),
            )
            conn.commit()
        time.sleep(SLEEP_BETWEEN_REQUESTS)
        continue

    match = resp.json()
    info = match["info"]
    patch = info["gameVersion"]
    queue_id = info["queueId"]

    # Store the full match as JSON text, plus extract a couple of columns for filtering.
    # json.dumps converts the Python dict back into a string we can store.
    try:
        cursor.execute("""
            INSERT INTO matches (match_id, patch, queue_id, raw_json)
            VALUES (?, ?, ?, ?)
        """, (match_id, patch, queue_id, json.dumps(match)))
    except sqlite3.IntegrityError:
        pass  # Already stored from a previous run; skip the insert.

    # Mark this match ID as fetched.
    cursor.execute("UPDATE match_ids SET fetched = 1 WHERE match_id = ?", (match_id,))
    conn.commit()

    successes += 1
    print(f"  [{i:>3}/{len(unfetched)}] {match_id}: patch {patch}")

    time.sleep(SLEEP_BETWEEN_REQUESTS)

# --- Summary ----------------------------------------------------------------
print(f"\n--- Summary ---")
print(f"Matches fetched this run: {successes}")
print(f"Errors this run: {errors}")

cursor.execute("SELECT COUNT(*) FROM matches")
total_matches = cursor.fetchone()[0]

cursor.execute("SELECT COUNT(*) FROM match_ids WHERE fetched = 1")
fetched_ids = cursor.fetchone()[0]
cursor.execute("SELECT COUNT(*) FROM match_ids")
total_ids = cursor.fetchone()[0]

print(f"Total matches in DB: {total_matches}")
print(f"Match IDs fetched: {fetched_ids}/{total_ids}")

# Show a breakdown by patch — useful for verifying data freshness.
cursor.execute("""
    SELECT patch, COUNT(*) AS n
    FROM matches
    GROUP BY patch
    ORDER BY patch DESC
""")
patch_breakdown = cursor.fetchall()
if patch_breakdown:
    print(f"\nMatches by patch:")
    for patch, n in patch_breakdown:
        print(f"  {patch}: {n}")

# Database file size, just for fun.
import os.path
size_mb = os.path.getsize("matches.db") / (1024 * 1024)
print(f"\nDatabase file size: {size_mb:.1f} MB")

conn.close()