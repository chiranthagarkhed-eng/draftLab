"""
Riot API helper — wraps requests.get() with proper rate-limit handling.

The previous behavior was: on any non-200, log and move on. That works at
~46 req/min where 429s are rare, but if Riot ever responds slowly or a script
runs hotter than expected, a 429 silently drops data. fetch_matches.py was
especially bad: it marked 429'd matches as "fetched", meaning they got
silently dropped from the dataset on next run.

This module fixes that with three rules:

  1. On 429: sleep for the Retry-After header (Riot always sends one), or
     RETRY_AFTER_FALLBACK if it's missing, then retry the same request.
  2. On 5xx: exponential backoff (BACKOFF_INITIAL * 2^attempt) up to MAX_RETRIES.
  3. On 200 / 4xx (other than 429): return immediately. Callers handle these.

Usage
-----
    from riot_api import get_with_retry
    resp = get_with_retry(url, headers=headers, params={"page": 1})
    if resp.status_code != 200:
        # handle 4xx etc. — same code as before
        ...
"""

import time
from typing import Optional

import requests

# Default wait time if Riot doesn't include a Retry-After header on 429.
# Riot's burst limit is 100/2min, so a 10-second pause clears most bursts.
RETRY_AFTER_FALLBACK = 10.0

# Number of times to retry a 5xx before giving up. 429s are not counted
# against this — they always retry, since Retry-After is bounded.
MAX_RETRIES_5XX = 3

# Initial backoff for 5xx. Doubles each attempt: 2s, 4s, 8s.
BACKOFF_INITIAL = 2.0


def get_with_retry(
    url: str,
    headers: Optional[dict] = None,
    params: Optional[dict] = None,
    timeout: float = 15.0,
) -> requests.Response:
    """GET with Riot-aware retries.

    Always returns a Response object. Caller is responsible for checking
    status_code on 200 / 4xx (other than 429). 429s and 5xx are handled
    internally and never surfaced to the caller (until 5xx exhausts retries,
    at which point the final 5xx response is returned).
    """
    attempt_5xx = 0
    while True:
        resp = requests.get(url, headers=headers, params=params, timeout=timeout)

        # Happy path + permanent client errors (4xx except 429) — return immediately.
        if resp.status_code != 429 and resp.status_code < 500:
            return resp

        if resp.status_code == 429:
            wait = _parse_retry_after(resp) or RETRY_AFTER_FALLBACK
            print(
                f"  [riot_api] 429 rate-limited — waiting {wait:.1f}s before retry",
                flush=True,
            )
            time.sleep(wait)
            continue

        # 5xx — Riot server error. Exponential backoff up to MAX_RETRIES_5XX.
        if attempt_5xx >= MAX_RETRIES_5XX:
            print(
                f"  [riot_api] 5xx exhausted after {attempt_5xx} retries "
                f"({resp.status_code}) — giving up on this request",
                flush=True,
            )
            return resp
        backoff = BACKOFF_INITIAL * (2 ** attempt_5xx)
        print(
            f"  [riot_api] {resp.status_code} server error — backoff {backoff:.1f}s "
            f"(retry {attempt_5xx + 1}/{MAX_RETRIES_5XX})",
            flush=True,
        )
        time.sleep(backoff)
        attempt_5xx += 1


def _parse_retry_after(resp: requests.Response) -> Optional[float]:
    """Read the Retry-After header (in seconds) from a 429 response."""
    raw = resp.headers.get("Retry-After")
    if not raw:
        return None
    try:
        # Riot sends an integer seconds value, never an HTTP-date.
        return float(raw)
    except ValueError:
        return None
