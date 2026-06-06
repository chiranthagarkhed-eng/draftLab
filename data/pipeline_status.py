import sqlite3

conn = sqlite3.connect("matches.db")
cursor = conn.cursor()

# Stage 1: Players
cursor.execute("SELECT COUNT(*) FROM players")
total_players = cursor.fetchone()[0]
cursor.execute("SELECT COUNT(*) FROM players WHERE matches_fetched_at IS NOT NULL")
processed_players = cursor.fetchone()[0]

# Stage 2: Match IDs
cursor.execute("SELECT COUNT(*) FROM match_ids")
total_match_ids = cursor.fetchone()[0]
cursor.execute("SELECT COUNT(*) FROM match_ids WHERE fetched = 1")
fetched_match_ids = cursor.fetchone()[0]
unfetched = total_match_ids - fetched_match_ids

# Stage 3: Matches
cursor.execute("SELECT COUNT(*) FROM matches")
total_matches = cursor.fetchone()[0]

print("=" * 50)
print("PIPELINE STATUS")
print("=" * 50)
print()
print(f"Stage 1 — Players")
print(f"  Total in DB:       {total_players:>6}")
print(f"  Processed:         {processed_players:>6} ({processed_players * 100 // max(total_players, 1)}%)")
print(f"  Remaining:         {total_players - processed_players:>6}")
print()
print(f"Stage 2 — Match IDs")
print(f"  Total discovered:  {total_match_ids:>6}")
print(f"  Fetched:           {fetched_match_ids:>6} ({fetched_match_ids * 100 // max(total_match_ids, 1)}%)")
print(f"  Unfetched (queue): {unfetched:>6}")
print()
print(f"Stage 3 — Matches")
print(f"  Total with details:{total_matches:>6}")
print()

# Verdict
print("=" * 50)
print("WHAT TO DO NEXT")
print("=" * 50)
if total_players < 1500:
    print("→ Run collect_players.py with more pages (PAGES_PER_DIVISION = 10).")
elif unfetched < 5000 and processed_players < total_players * 0.7:
    print("→ Keep running collect_match_ids.py to grow the match ID queue.")
    print(f"   Goal: ~10,000 unique match IDs (you have {total_match_ids}).")
elif total_matches < 5000:
    print("→ Run fetch_matches.py to pull full match details.")
    print(f"   Goal: ~5,000-10,000 matches (you have {total_matches}).")
else:
    print(f"→ You have {total_matches} matches. Ready for Week 2 (stats compiler).")
    print("   You can always grow the dataset later — the pipeline is resumable.")

conn.close()