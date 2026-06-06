import sqlite3

# Connect to (or create) a database file in the current folder.
# SQLite is a file-based database — no server needed.
conn = sqlite3.connect("matches.db")
cursor = conn.cursor()

# Table 1: players we've discovered.
# Stores the PUUIDs we've found along with their rank info.
cursor.execute("""
    CREATE TABLE IF NOT EXISTS players (
        puuid TEXT PRIMARY KEY,
        tier TEXT NOT NULL,
        rank TEXT NOT NULL,
        league_points INTEGER,
        wins INTEGER,
        losses INTEGER,
        collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
""")

# Table 2: match IDs we've discovered.
# 'fetched' tracks which ones we've already pulled full details for — lets us resume.
cursor.execute("""
    CREATE TABLE IF NOT EXISTS match_ids (
        match_id TEXT PRIMARY KEY,
        fetched INTEGER DEFAULT 0,
        discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
""")

# Table 3: full match data.
# We store the raw JSON so we can extract more fields later if needed,
# plus a few key columns (patch, queue_id) extracted for easy filtering.
cursor.execute("""
    CREATE TABLE IF NOT EXISTS matches (
        match_id TEXT PRIMARY KEY,
        patch TEXT,
        queue_id INTEGER,
        raw_json TEXT NOT NULL,
        collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
""")

# Save changes to the file.
conn.commit()

# Verify by listing the tables that exist.
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cursor.fetchall()
print("Tables in matches.db:")
for table in tables:
    print(f"  - {table[0]}")

conn.close()
print("\nDatabase initialized successfully.")