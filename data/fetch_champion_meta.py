import json
import requests

# --- Get the current patch --------------------------------------------------
versions_resp = requests.get("https://ddragon.leagueoflegends.com/api/versions.json")
patch = versions_resp.json()[0]
print(f"Current patch: {patch}\n")

# --- Get champion data -----------------------------------------------------
champ_resp = requests.get(
    f"https://ddragon.leagueoflegends.com/cdn/{patch}/data/en_US/champion.json"
)
champs_raw = champ_resp.json()["data"]

# --- Hand-curated overrides for known awkward cases ------------------------
# Riot's auto-tags miss some hybrids/special cases. Override here.
OVERRIDES = {
    # --- Damage type overrides (champions whose build path doesn't match
    # Riot's attack/magic info scores) ---
    "Akali":     {"damage_type": "AP", "is_frontline": False},
    "Akshan":    {"damage_type": "AD"},
    "Camille":   {"damage_type": "AD", "is_frontline": False},
    "Diana":     {"damage_type": "AP"},
    "Ekko":      {"damage_type": "AP"},
    "Evelynn":   {"damage_type": "AP"},
    "Fizz":      {"damage_type": "AP"},
    "Gnar":      {"is_frontline": True},
    "Kassadin":  {"damage_type": "AP"},
    "Katarina":  {"damage_type": "AP"}, 
    "Kayle":     {"damage_type": "AP", "is_ranged": True},  # becomes ranged at lvl 6
    "LeBlanc":   {"damage_type": "AP"},
    "Lillia":    {"damage_type": "AP"},
    "Nidalee":   {"damage_type": "AP"},
    "Rumble":    {"damage_type": "AP"},
    "Sylas":     {"damage_type": "AP"},
    "Teemo":     {"damage_type": "AP"},
    "Vladimir":  {"damage_type": "AP"},

    # --- Frontline overrides (Fighter-tagged champions who play as
    # carries/duelists, not real frontline) ---
    "Yasuo":      {"is_frontline": False},
    "Yone":       {"is_frontline": False},
    "Tryndamere": {"is_frontline": False},
    "MasterYi":   {"is_frontline": False},
    "Jax":        {"is_frontline": False},
    "Riven":      {"is_frontline": False},
    "Irelia":     {"is_frontline": False},
    "Fiora":      {"is_frontline": False},

    # --- Range overrides ---
    "Thresh": {"is_ranged": False},  # 450 AA range but plays melee
}

# --- Classify each champion ------------------------------------------------
def classify(champ):
    tags = champ["tags"]
    info = champ["info"]
    stats = champ["stats"]

    # Damage type — use info.attack vs info.magic scores.
    if info["attack"] > info["magic"]:
        damage_type = "AD"
    elif info["magic"] > info["attack"]:
        damage_type = "AP"
    else:
        # Tie — use tags as tiebreaker.
        damage_type = "AP" if "Mage" in tags else "AD"

    # Frontline: tank or fighter (Riot's tags).
    is_frontline = ("Tank" in tags) or ("Fighter" in tags)

    # Ranged: attack range > 300 (melee champs are ~125-200).
    is_ranged = stats["attackrange"] > 300

    return {
        "damage_type": damage_type,
        "is_frontline": is_frontline,
        "is_ranged": is_ranged,
    }

results = {}
for name, champ in champs_raw.items():
    classification = classify(champ)

    # Apply overrides if any.
    if name in OVERRIDES:
        classification.update(OVERRIDES[name])

    results[name] = {
        "name": champ["name"],
        "tags": champ["tags"],
        **classification,
    }

# --- Save ------------------------------------------------------------------
output = {"patch": patch, "champions": results}
with open("champion_meta.json", "w") as f:
    json.dump(output, f, indent=2)

# --- Summary ---------------------------------------------------------------
print(f"Classified {len(results)} champions.\n")

ad = sum(1 for c in results.values() if c["damage_type"] == "AD")
ap = sum(1 for c in results.values() if c["damage_type"] == "AP")
print(f"Damage type breakdown:")
print(f"  AD: {ad}")
print(f"  AP: {ap}\n")

frontline = sum(1 for c in results.values() if c["is_frontline"])
ranged = sum(1 for c in results.values() if c["is_ranged"])
print(f"Frontline champions: {frontline}")
print(f"Ranged champions:    {ranged}\n")

# Sample some well-known champions so you can sanity-check.
print("Sample classifications:")
samples = ["Aatrox", "Ahri", "Akali", "Garen", "Jinx", "Lulu", "Yasuo",
           "Thresh", "Lux", "Kayle", "Malphite", "Caitlyn"]
print(f"{'Champion':<15} {'Damage':<7} {'Frontline':<10} {'Ranged':<7}")
print("-" * 45)
for name in samples:
    if name in results:
        c = results[name]
        fl = "yes" if c["is_frontline"] else "no"
        rg = "yes" if c["is_ranged"] else "no"
        print(f"{c['name']:<15} {c['damage_type']:<7} {fl:<10} {rg:<7}")

print(f"\nWrote champion_meta.json")