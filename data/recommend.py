import json
import math
from itertools import combinations

SHRINKAGE_FLOOR = 1000
ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]


def shrunk_delta(winrate, games):
    if games <= 0:
        return 0.0
    raw_delta = winrate - 0.5
    confidence = min(1.0, math.sqrt(games / SHRINKAGE_FLOOR))
    return raw_delta * confidence


# --- Loading ---------------------------------------------------------------
def load_stats(path="stats.json"):
    with open(path) as f:
        raw = json.load(f)
    base = {(r["champion"], r["role"]): r for r in raw["champion_role_stats"]}
    matchup = {(r["champion"], r["vs_champion"], r["role"]): r for r in raw["matchup_stats"]}
    synergy = {(r["champion_a"], r["champion_b"]): r for r in raw["synergy_stats"]}
    all_champions = sorted({r["champion"] for r in raw["champion_role_stats"]})
    return {
        "meta": raw["meta"], "base": base, "matchup": matchup,
        "synergy": synergy, "all_champions": all_champions,
    }


def load_champion_meta(path="champion_meta.json"):
    with open(path) as f:
        return json.load(f)["champions"]


# --- Lookups (return (delta, games)) ---------------------------------------
def get_base(stats, champion, role):
    r = stats["base"].get((champion, role))
    if not r:
        return 0.0, 0
    return shrunk_delta(r["winrate"], r["games"]), r["games"]

def get_matchup(stats, champion, vs_champion, role):
    r = stats["matchup"].get((champion, vs_champion, role))
    if not r:
        return 0.0, 0
    return shrunk_delta(r["winrate"], r["games"]), r["games"]

def get_synergy(stats, champion_a, champion_b):
    a, b = sorted([champion_a, champion_b])
    r = stats["synergy"].get((a, b))
    if not r:
        return 0.0, 0
    return shrunk_delta(r["winrate"], r["games"]), r["games"]


# --- Composition -----------------------------------------------------------
def composition_score(team, champion_meta):
    n = len(team)
    if n == 0:
        return 0.0
    fl = sum(1 for c in team if champion_meta.get(c, {}).get("is_frontline", False))
    ad = sum(1 for c in team if champion_meta.get(c, {}).get("damage_type") == "AD")
    ap = sum(1 for c in team if champion_meta.get(c, {}).get("damage_type") == "AP")
    rng = sum(1 for c in team if champion_meta.get(c, {}).get("is_ranged", False))
    mel = n - rng

    score = 0.0
    if n >= 3:
        if fl == 0: score -= 0.06
        elif fl >= 4: score -= 0.03
    if n >= 4:
        if ap == 0 or ad == 0: score -= 0.06
        elif abs(ad - ap) >= 3: score -= 0.02
    if n >= 4:
        if rng == 0: score -= 0.04
        elif mel == 0: score -= 0.03
    return score


def composition_summary(team, champion_meta):
    if not team:
        return "(empty)"
    n = len(team)
    fl = sum(1 for c in team if champion_meta.get(c, {}).get("is_frontline", False))
    ad = sum(1 for c in team if champion_meta.get(c, {}).get("damage_type") == "AD")
    ap = sum(1 for c in team if champion_meta.get(c, {}).get("damage_type") == "AP")
    rng = sum(1 for c in team if champion_meta.get(c, {}).get("is_ranged", False))
    return f"{fl}/{n} frontline | {ad} AD / {ap} AP | {rng} ranged / {n - rng} melee"


# --- Pick recommendation (used when you're mid-draft) ----------------------
def recommend(stats, champion_meta, ally_team, enemy_team, role, top_n=5, min_base_games=30, user_pool=None):
    taken = set(ally_team) | set(enemy_team.values())
    candidates = [c for c in stats["all_champions"] if c not in taken]

    # NEW: if a user pool was provided, filter to only champions in their pool for this role.
    if user_pool is not None:
        role_pool = {entry["champion"] for entry in user_pool.get(role, [])}
        candidates = [c for c in candidates if c in role_pool]

    baseline_comp = composition_score(ally_team, champion_meta)

    results = []
    for c in candidates:
        base_delta, base_games = get_base(stats, c, role)
        if base_games < min_base_games:
            continue

        enemy_laner = enemy_team.get(role)
        if enemy_laner:
            matchup_delta, matchup_games = get_matchup(stats, c, enemy_laner, role)
        else:
            matchup_delta, matchup_games = 0.0, 0

        synergy_delta = sum(get_synergy(stats, c, ally)[0] for ally in ally_team)

        team_with = ally_team + [c]
        comp_delta = composition_score(team_with, champion_meta) - baseline_comp

        results.append({
            "champion": c,
            "score": base_delta + matchup_delta + synergy_delta + comp_delta,
            "base": {"delta": base_delta, "games": base_games},
            "matchup": {"vs": enemy_laner, "delta": matchup_delta, "games": matchup_games},
            "synergy_delta": synergy_delta,
            "composition": {
                "delta": comp_delta,
                "team_summary": composition_summary(team_with, champion_meta),
            },
        })

    results.sort(key=lambda r: -r["score"])
    return results[:top_n]


# --- Full-draft evaluation (Blue vs Red) -----------------------------------
def evaluate_matchup(stats, champion_meta, blue_team, red_team):
    """
    Both teams are dicts {role: champion}. Returns evaluation showing which
    side is favored and why, broken out by component.
    """
    # 1) Sum of base win-rate deltas on each side.
    blue_base = sum(get_base(stats, c, r)[0] for r, c in blue_team.items())
    red_base  = sum(get_base(stats, c, r)[0] for r, c in red_team.items())
    base_edge = blue_base - red_base

    # 2) Per-role lane matchups (only counts roles where both sides have picks).
    matchup_edge = 0.0
    matchup_details = []
    for role in ROLES:
        if role in blue_team and role in red_team:
            d, g = get_matchup(stats, blue_team[role], red_team[role], role)
            matchup_edge += d
            matchup_details.append({
                "role": role, "blue": blue_team[role], "red": red_team[role],
                "delta": d, "games": g,
            })

    # 3) Within-team pairwise synergies.
    blue_syn = sum(get_synergy(stats, a, b)[0] for a, b in combinations(blue_team.values(), 2))
    red_syn  = sum(get_synergy(stats, a, b)[0] for a, b in combinations(red_team.values(), 2))
    synergy_edge = blue_syn - red_syn

    # 4) Composition score per side.
    blue_comp = composition_score(list(blue_team.values()), champion_meta)
    red_comp  = composition_score(list(red_team.values()), champion_meta)
    comp_edge = blue_comp - red_comp

    # Sum all four components.
    total_edge = base_edge + matchup_edge + synergy_edge + comp_edge

    # Convert to a projected win rate. Simple linear formula clamped at [5%, 95%].
    blue_winrate = max(0.05, min(0.95, 0.5 + total_edge))
    red_winrate = 1.0 - blue_winrate

    return {
        "blue_winrate": blue_winrate,
        "red_winrate": red_winrate,
        "total_edge": total_edge,
        "base":        {"blue": blue_base, "red": red_base, "edge": base_edge},
        "matchup":     {"edge": matchup_edge, "details": matchup_details},
        "synergy":     {"blue": blue_syn, "red": red_syn, "edge": synergy_edge},
        "composition": {"blue": blue_comp, "red": red_comp, "edge": comp_edge},
    }


# --- Printing helpers ------------------------------------------------------
def pct(x):
    return f"{x * 100:+.2f}%"

def print_recommendations(results, role):
    print(f"\nTop {len(results)} suggestions for {role}:\n")
    for i, r in enumerate(results, start=1):
        print(f"  {i}. {r['champion']:<15} score: {pct(r['score'])}")
        print(f"     base:        {pct(r['base']['delta'])} ({r['base']['games']} games)")
        if r['matchup']['vs']:
            print(f"     matchup:     {pct(r['matchup']['delta'])} vs {r['matchup']['vs']} ({r['matchup']['games']} games)")
        else:
            print(f"     matchup:     — (no enemy in this role yet)")
        print(f"     synergy:     {pct(r['synergy_delta'])}")
        print(f"     composition: {pct(r['composition']['delta'])}")
        print(f"                  team with pick → {r['composition']['team_summary']}")
        print()

def print_evaluation(result, blue_team, red_team, champion_meta):
    print()
    print("=" * 62)
    print("DRAFT EVALUATION")
    print("=" * 62)

    print("\nBlue side:")
    for role in ROLES:
        if role in blue_team:
            print(f"  {role:<8} {blue_team[role]}")
    print(f"  comp → {composition_summary(list(blue_team.values()), champion_meta)}")

    print("\nRed side:")
    for role in ROLES:
        if role in red_team:
            print(f"  {role:<8} {red_team[role]}")
    print(f"  comp → {composition_summary(list(red_team.values()), champion_meta)}")

    print(f"\nProjected win rate:")
    print(f"  Blue: {result['blue_winrate'] * 100:>5.1f}%")
    print(f"  Red:  {result['red_winrate'] * 100:>5.1f}%")

    print(f"\nEdge breakdown (+ favors Blue, - favors Red):")
    print(f"  Base WR:       {pct(result['base']['edge'])}")
    print(f"                 (Blue: {pct(result['base']['blue'])} | Red: {pct(result['base']['red'])})")
    print(f"  Lane matchups: {pct(result['matchup']['edge'])}")
    for m in result['matchup']['details']:
        print(f"    {m['role']:<8} {m['blue']:<14} vs {m['red']:<14} {pct(m['delta']):>9} ({m['games']:>3} games)")
    print(f"  Synergies:     {pct(result['synergy']['edge'])}")
    print(f"                 (Blue: {pct(result['synergy']['blue'])} | Red: {pct(result['synergy']['red'])})")
    print(f"  Composition:   {pct(result['composition']['edge'])}")
    print(f"                 (Blue: {pct(result['composition']['blue'])} | Red: {pct(result['composition']['red'])})")
    print(f"\n  TOTAL EDGE:    {pct(result['total_edge'])}")
    print("=" * 62)


if __name__ == "__main__":
    stats = load_stats()
    champion_meta = load_champion_meta()

    # Load the user's personal pool if it exists.
    user_pool = None
    try:
        with open("user_pool.json") as f:
            user_pool_data = json.load(f)
            user_pool = user_pool_data["pool"]
            print(f"Loaded personal pool for {user_pool_data['account']['game_name']}.\n")
    except FileNotFoundError:
        print("(No user_pool.json found — recommendations will not be filtered by personal pool.)\n")

    print(f"Loaded stats from {stats['meta']['matches_processed']} matches.")
    print(f"Have data on {len(stats['all_champions'])} champions.")
    print(f"Champion metadata for {len(champion_meta)} champions.\n")

    # ========================================================================
    # DEMO 1: Pick suggestion (mid-draft, you're picking next)
    # ========================================================================
    ally_team = ["Garen", "LeeSin", "Jinx", "Lulu"]
    enemy_team = {
        "TOP": "Darius", "JUNGLE": "Graves", "MIDDLE": "Yasuo",
        "BOTTOM": "Caitlyn", "UTILITY": "Nami",
    }
    role_we_pick = "MIDDLE"

    print("=== Demo 1: Pick suggestion ===")
    print(f"Your team:  {ally_team}")
    print(f"             baseline comp → {composition_summary(ally_team, champion_meta)}")
    print(f"Enemy:      {enemy_team}")
    print(f"Picking:    {role_we_pick}")

    results = recommend(stats, champion_meta, ally_team, enemy_team, role_we_pick, top_n=5, user_pool=user_pool)
    print_recommendations(results, role_we_pick)

    # ========================================================================
    # DEMO 2: Full 5v5 draft evaluation (which side is favored?)
    # ========================================================================
    blue_team = {
        "TOP": "Garen", "JUNGLE": "LeeSin", "MIDDLE": "Ahri",
        "BOTTOM": "Jinx", "UTILITY": "Lulu",
    }
    red_team = {
        "TOP": "Darius", "JUNGLE": "Graves", "MIDDLE": "Yasuo",
        "BOTTOM": "Caitlyn", "UTILITY": "Nami",
    }

    evaluation = evaluate_matchup(stats, champion_meta, blue_team, red_team)
    print_evaluation(evaluation, blue_team, red_team, champion_meta)