"""
DraftLab pipeline orchestrator.

Runs the 6-step data pipeline end-to-end:

  1. init_db.py              — create SQLite tables (idempotent)
  2. fetch_champion_meta.py  — pull current patch + champion meta from Data Dragon
  3. collect_players.py      — scrape ranked players from Riot API
  4. collect_match_ids.py    — fetch each player's recent match IDs
  5. fetch_matches.py        — download full match details
  6. compile_stats.py        — aggregate into stats.json

Then copies stats.json and champion_meta.json into the web app's /public so
the frontend picks them up on next reload.

Each step's stdout/stderr streams live to the terminal so you can watch
progress through long Riot API runs.

Usage
-----
  python run_pipeline.py                # full run, all 6 steps + copy
  python run_pipeline.py --init         # also re-run init_db.py first
  python run_pipeline.py --skip-fetch   # skip steps 3-5, just recompile + copy
  python run_pipeline.py --skip-meta    # skip fetch_champion_meta.py
  python run_pipeline.py --no-copy      # don't sync into web/public
  python run_pipeline.py --status       # just print pipeline_status.py and exit

Notes
-----
- Each underlying script is idempotent / resumable. Re-running the pipeline
  picks up where the last run left off (resume from DB state).
- A failure in any step aborts the rest of the run and exits non-zero.
- The pipeline assumes RIOT_API_KEY is set in data/.env (loaded by the
  individual scripts).
"""

import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

# Project layout — this file lives in data/, web/public is two levels up.
DATA_DIR = Path(__file__).resolve().parent
WEB_PUBLIC = DATA_DIR.parent / "web" / "public"

# Files we sync into web/public after the pipeline completes.
COPY_TARGETS = ["stats.json", "champion_meta.json"]


def run_step(label: str, script: str) -> None:
    """Run one pipeline script as a subprocess, streaming output live.

    Raises SystemExit if the script returns non-zero.
    """
    script_path = DATA_DIR / script
    if not script_path.exists():
        sys.exit(f"[pipeline] missing script: {script_path}")

    bar = "=" * 60
    print(f"\n{bar}\n[pipeline] {label}  ({script})\n{bar}", flush=True)
    t0 = time.time()
    result = subprocess.run(
        [sys.executable, str(script_path)],
        cwd=DATA_DIR,  # scripts use relative paths (matches.db, stats.json)
    )
    elapsed = time.time() - t0
    if result.returncode != 0:
        sys.exit(
            f"\n[pipeline] {script} failed with exit code {result.returncode} "
            f"after {elapsed:.1f}s — aborting."
        )
    print(f"[pipeline] {script} finished in {elapsed:.1f}s", flush=True)


def copy_to_web() -> None:
    """Sync derived artifacts into the web app's /public directory."""
    if not WEB_PUBLIC.exists():
        print(
            f"[pipeline] skip copy — {WEB_PUBLIC} doesn't exist "
            f"(running outside the repo?)",
            flush=True,
        )
        return
    print(f"\n[pipeline] syncing artifacts -> {WEB_PUBLIC}", flush=True)
    for fname in COPY_TARGETS:
        src = DATA_DIR / fname
        dst = WEB_PUBLIC / fname
        if not src.exists():
            print(f"  [skip] {fname} not found in data/", flush=True)
            continue
        shutil.copyfile(src, dst)
        size_mb = dst.stat().st_size / (1024 * 1024)
        print(f"  [copied] {fname}  ({size_mb:.2f} MB)", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="DraftLab end-to-end pipeline runner."
    )
    parser.add_argument(
        "--init",
        action="store_true",
        help="Run init_db.py before the rest. Safe to include on every run "
        "(the schema creation is idempotent), but normally only needed once.",
    )
    parser.add_argument(
        "--skip-fetch",
        action="store_true",
        help="Skip all Riot API calls (players, match IDs, match details). "
        "Use this when you only changed compile_stats.py and want a fast "
        "recompile + copy.",
    )
    parser.add_argument(
        "--skip-meta",
        action="store_true",
        help="Skip fetch_champion_meta.py. Use when you know the patch hasn't "
        "changed since last run.",
    )
    parser.add_argument(
        "--no-copy",
        action="store_true",
        help="Don't copy stats.json / champion_meta.json into web/public.",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Just print pipeline_status.py and exit.",
    )
    args = parser.parse_args()

    if args.status:
        run_step("Status", "pipeline_status.py")
        return

    started = time.time()

    if args.init:
        run_step("Step 0  — Init database", "init_db.py")

    if not args.skip_meta:
        run_step("Step 1  — Fetch champion meta (Data Dragon)", "fetch_champion_meta.py")
    else:
        print("[pipeline] skipping fetch_champion_meta.py (--skip-meta)", flush=True)

    if not args.skip_fetch:
        run_step("Step 2  — Collect players from Riot API", "collect_players.py")
        run_step("Step 3  — Collect match IDs per player", "collect_match_ids.py")
        run_step("Step 4  — Fetch full match details", "fetch_matches.py")
    else:
        print(
            "[pipeline] skipping steps 2-4 (--skip-fetch) — recompile + copy only",
            flush=True,
        )

    run_step("Step 5  — Compile stats.json", "compile_stats.py")

    if not args.no_copy:
        copy_to_web()
    else:
        print("[pipeline] skipping copy step (--no-copy)", flush=True)

    total = time.time() - started
    print(
        f"\n[pipeline] DONE — total wall time {total:.1f}s "
        f"({total/60:.1f} min)",
        flush=True,
    )


if __name__ == "__main__":
    main()
