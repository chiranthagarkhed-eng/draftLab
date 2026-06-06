# DraftLab

A personalized, transparent League of Legends draft assistant for solo queue
players. Tells you the best pick you can actually play, with confidence we
actually have.

**Demo:** draftlab-lol.vercel.app 

---

## What's different about it

Most draft tools converge on the same shape: scrape match data, rank
champions, hope the user figures out the rest. DraftLab makes three
deliberate bets:

### Pillar 1 — Personalization

Every recommendation is filtered through *your* champion pool. Existing tools
will tell you Aatrox is the strongest top pick; that doesn't help if you
don't play Aatrox. DraftLab pulls your last 30 ranked solo matches from the
Riot API, builds a per-role pool, and nudges the engine toward champions you
actually have meaningful games on. The personalization weight is bounded
(~2.5 winrate points max) so a thin pool can't override a clearly stronger
meta pick — it just promotes good picks you can play over good picks you
can't.

### Pillar 2 — Coaching, not answer-machine

Each top recommendation comes with a 2–3 sentence rationale streamed from
Claude Haiku 4.5. The model is given a structured "Facts" block of
pre-computed deltas (base winrate, matchup contributions, synergies,
sample sizes) and is explicitly told to *narrate, never compute*. So the
commentary reads like:

> Sivir is the strongest pick from your pool here. She's a +5.8% base over
> 1,001 games and gains another +1.2% against their Nami support
> specifically, where her spell shield trivializes most engages.

The system prompt forbids inventing winrates or sample sizes — the engine
stays the source of truth for numbers.

### Pillar 3 — Honest uncertainty

Every numerical stat in the UI carries a sample-size badge and a confidence
color treatment. Stats below 100 games are visually muted; over 500 they're
emphasized. When the top recommendation has fewer than 200 games at its
role, DraftLab surfaces a yellow callout and points to a higher-confidence
alternative if one exists within 1.5pp of the top score. Where competitors
quietly show "+8% winrate" off a 12-game sample, DraftLab refuses to
overstate.

---

## How it works

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Riot Games API   │───▶│ Python ingestion │───▶│ SQLite           │
│ (RANKED_SOLO_5x5)│    │ (collect_*.py)   │    │ (matches.db)     │
└──────────────────┘    └──────────────────┘    └──────────────────┘
                                                          │
                                ┌─────────────────────────┘
                                ▼
                       ┌──────────────────┐    ┌──────────────────┐
                       │ Stats compiler   │───▶│ stats.json       │
                       │ (compile_stats)  │    │ (6 MB, /public)  │
                       └──────────────────┘    └──────────────────┘
                                                          │
                                ┌─────────────────────────┘
                                ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Next.js client   │◀──▶│ Recommendation   │◀──▶│ /api/commentary  │
│ (React, Tailwind)│    │ engine (TS)      │    │ (Claude Haiku)   │
└──────────────────┘    └──────────────────┘    └──────────────────┘
```

The web app loads `stats.json` once on first visit; recommendation scoring
is entirely client-side after that. Only two things hit a server during a
session: the optional LLM coaching commentary, and the optional Riot Account
lookup for the user's pool.

---

## Technical deep dive: confidence shrinkage

A draft tool's most dangerous failure mode is *false precision*: showing
"+8.4% winrate" off a 17-game sample, the user trusts it, the user loses.
Most existing tools surface raw winrates without sample-size context.
DraftLab applies a sample-size-aware shrinkage to every contribution before
scoring or displaying:

```ts
shrunkDelta(rawWinrate, games) =
  (rawWinrate - 0.5) * min(1, sqrt(games / 1000))
```

A matchup with 1,000 games behind it gets its full delta; a matchup with 100
games gets 31.6% of its delta. The shape (sqrt rather than linear or
sigmoid) is what statisticians call a James-Stein–flavored shrinkage:
flexible enough to trust real signal at high N, aggressive enough to crush
noise at low N.

I made this a first-class design choice rather than a back-of-house
implementation detail. Sample sizes appear next to every stat, the engine
uses different game-count floors for in-lane vs cross-role matchups (20
vs 40 — cross-role data is sparser per pair), and the UI explicitly refuses
to recommend a thin-data top pick without offering a higher-confidence
alternative.

**Why not just use Wilson intervals?** I considered them. Wilson gives you
a confidence interval around a winrate, which is conceptually cleaner. But
the engine isn't *comparing* one winrate to a threshold — it's *summing*
multiple deltas across components (base, matchups, synergies, composition).
Shrinking each delta independently before summing is simpler to reason
about, easier to display ("here's the delta, here's the sample"), and
produces the same qualitative behavior at the user-facing level. Wilson
would be the right tool if I were building an academic stats explorer; for
a UX-first recommendation engine, shrunken deltas are the right abstraction.

---

## Cross-role matchup analysis

One thing I built that's missing from every existing tool: cross-role
matchups. Existing tools store only same-lane data — "Aphelios vs Caitlyn
in BOT". But Aphelios also cares about the enemy *jungler*: a Jarvan IV is
brutal into an immobile ADC. DraftLab aggregates all 25 cross-team
pair-roles per match (not just the 5 in-lane ones), then applies a
role-interaction weight matrix when scoring:

| Pairing | Weight | Why |
|---|---|---|
| Same role | 1.0 | Direct lane matchup |
| BOT ↔ SUP | 0.7 | Same lane, 2v2 |
| JG ↔ any | 0.5 | Junglers gank everywhere |
| MID ↔ side | 0.3 | Mid roams |
| TOP ↔ BOT/SUP | 0.2 | Mostly only meets in teamfights |

So an Aphelios pick against an enemy Jarvan JG gets a partial credit
adjustment for the bad cross-role matchup, weighted appropriately for how
much those positions actually interact during a game. The cross-role
threshold is higher (40 games vs 20 for in-lane) because cross-role data is
sparser per pair.

---

## Running locally

### Prerequisites

- Node 18+ and npm
- Python 3.10+ (for the data pipeline)
- A [Riot API key](https://developer.riotgames.com/) (personal tier is fine)
- *Optional:* an [Anthropic API key](https://console.anthropic.com/) for
  coaching commentary. Without it, the app gracefully falls back to a
  structured engine breakdown.

### Setup

```bash
git clone <this repo>
cd draftlab

# Data pipeline
cd data
python3 -m venv venv && source venv/bin/activate
pip install requests python-dotenv
cp .env.example .env  # then add your RIOT_API_KEY (and optionally ANTHROPIC_API_KEY)
python run_pipeline.py --init  # first-time DB setup + initial ingest

# Web app
cd ../web
npm install
npm run dev  # http://localhost:3000/draft
```

### Refreshing data

```bash
cd data
python run_pipeline.py                  # full refresh (~40 min, hits Riot API)
python run_pipeline.py --skip-fetch     # just recompile stats + copy to /public
python run_pipeline.py --status         # how full is the DB
```

The pipeline is resumable — each underlying script checks the DB and picks
up where it left off, so a network blip is harmless. Rate limiting is
built in (1.3s between calls + 429-aware retry with Retry-After honored).

---

## Deploying to Vercel

The repo has both `data/` (Python pipeline) and `web/` (Next.js app). Only
the `web/` side ships.

1. Push the repo to GitHub.
2. In Vercel, **import the repo and set Root Directory to `web`**.
3. Set environment variables in the project settings:
   - `RIOT_API_KEY` — required for the `/pool` page to work
   - `ANTHROPIC_API_KEY` — optional; without it the LLM commentary degrades
     to the structured engine breakdown
4. Deploy. The `.vercelignore` at the repo root keeps `data/matches.db` and
   the Python sources out of the bundle.

The API routes prefer `process.env.X` over the local `data/.env` file, so
the dev workflow keeps working unchanged after this is set up.

---

## Project structure

```
draftlab/
├── README.md           ← you are here
├── .vercelignore
├── data/               ← Python ingestion + stats pipeline
│   ├── run_pipeline.py    ← orchestrator (one command for the whole pipeline)
│   ├── collect_players.py ← scrape ranked-solo players
│   ├── collect_match_ids.py
│   ├── fetch_matches.py
│   ├── compile_stats.py   ← matches.db → stats.json
│   ├── riot_api.py        ← shared Riot API retry/backoff helper
│   ├── matches.db         ← local SQLite (not committed)
│   └── stats.json         ← compiled output (also copied to web/public/)
└── web/                ← Next.js app (App Router, TypeScript, Tailwind)
    ├── app/
    │   ├── draft/page.tsx       ← main draft surface
    │   ├── pool/page.tsx        ← personal pool builder
    │   └── api/
    │       ├── pool/route.ts    ← Riot ID → champion pool
    │       └── commentary/route.ts ← Claude Haiku streaming coach
    ├── components/
    │   ├── DraftBoard.tsx       ← 5v5 + bans, URL-encoded state
    │   ├── MatchupAnalysis.tsx  ← live win-probability readout
    │   ├── Recommendations.tsx  ← top-5 with confidence + LLM rationales
    │   ├── ChampionPicker.tsx
    │   ├── ConfidenceBadge.tsx
    │   └── ...
    └── lib/
        ├── engine.ts            ← scoring + matchup eval (pure TS)
        ├── confidence.ts        ← shrinkage thresholds + display rules
        ├── data.ts              ← stats.json + champion meta loaders
        ├── urlState.ts          ← shareable draft URL codec
        └── useCommentary.ts     ← LLM streaming hook (cache + debounce)
```

---

## What's intentionally out of scope (for the MVP)

- Native mobile apps
- Real-time LCU client overlay
- Multi-user team drafting rooms (drafter.lol's space)
- Accounts and cross-device sync
- Build / rune / item recommendations
- Beating Draftgap on raw data volume

---

## Riot acknowledgments

DraftLab isn't endorsed by Riot Games and doesn't reflect the views or
opinions of Riot Games or anyone officially involved in producing or
managing League of Legends. League of Legends and Riot Games are trademarks
or registered trademarks of Riot Games, Inc.

Data is fetched via the public Riot Games API under a personal development
key, used responsibly and rate-limited.
