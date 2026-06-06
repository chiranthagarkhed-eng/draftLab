import json
import sqlite3
from collections import Counter

conn = sqlite3.connect("matches.db")
cursor = conn.cursor()

# --- Volume -----------------------------------------------------------------
cursor.execute("SELECT COUNT(*) FROM matches")
total = cursor.fetchone()[0]
print(f"Total matches in DB: {total}\n")

# --- Patch breakdown --------------------------------------------------------
cursor.execute("""
    SELECT patch, COUNT(*) AS n
    FROM matches
    GROUP BY patch
    ORDER BY n DESC
""")
print("Matches by patch:")
for patch, count in cursor.fetchall():
    print(f"  {patch}: {count}")
print()

# --- Champion coverage ------------------------------------------------------
# Parse the stored JSON to count champion appearances across all matches.
cursor.execute("SELECT raw_json FROM matches")
champion_counts = Counter()
total_picks = 0
for (raw_json,) in cursor.fetchall():
    match = json.loads(raw_json)
    for p in match["info"]["participants"]:
        champion_counts[p["championName"]] += 1
        total_picks += 1

unique_champs = len(champion_counts)
print(f"Unique champions seen: {unique_champs} (out of ~165 total)")
print(f"Total picks (10 per match): {total_picks}\n")

# Sample size buckets — useful for the honest-uncertainty pillar.
strong = sum(1 for c in champion_counts.values() if c >= 200)
ok = sum(1 for c in champion_counts.values() if 100 <= c < 200)
weak = sum(1 for c in champion_counts.values() if c < 100)
print(f"Champions with 200+ picks (strong sample):  {strong}")
print(f"Champions with 100–199 picks (decent):       {ok}")
print(f"Champions with <100 picks (low confidence):  {weak}")
print()

# Top and bottom champions in our dataset.
print("Most-picked champions in your dataset:")
for champ, n in champion_counts.most_common(10):
    print(f"  {champ:18} {n}")
print()

print("Least-picked champions (lowest 10):")
for champ, n in sorted(champion_counts.items(), key=lambda x: x[1])[:10]:
    print(f"  {champ:18} {n}")
print()

# --- Verdict ----------------------------------------------------------------
print("=== Verdict ===")
if total < 3000:
    print(f"Only {total} matches — too noisy for most stats.")
    print("Keep collecting. Aim for at least 5,000.")
elif total >= 5000 and strong >= 20:
    print(f"{total} matches, {strong} champions with strong samples.")
    print("Ready to move to Week 2 (stats compiler). Grow more later if you want.")
elif total >= 5000:
    print(f"{total} matches but only {strong} champions with 200+ picks.")
    print("This is enough to ship an honest MVP — your uncertainty pillar handles thin matchups.")
    print("Consider one more session to push 'strong sample' champs above 20.")
else:
    print(f"{total} matches is on the low end. Grow to ~5,000 for comfort.")

conn.close()