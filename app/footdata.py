"""football-data.org live-score sync.

When `FOOTBALL_DATA_API_KEY` is set, the `GET /api/live/` poll calls
`sync_live_from_api()`. It fetches the World Cup match list from
football-data.org, maps each match onto our internal match number, and
upserts the score into the `live_matches` table — the same table the admin
writes to. The existing 10s frontend poll then surfaces it, and the
server-side leaderboard (which already reads `live_matches`) scores it.

Design notes:
- A module-level 10s cache gates the external call, so no matter how many
  browsers poll, we hit football-data.org at most ~6×/min — well under the
  free tier's 10 req/min limit.
- Every external call is best-effort: any failure is swallowed and logged,
  so the poll always still returns whatever is already in the DB.
- Matches that already have a FINAL result are skipped — a finalized match
  stays locked and the feed can't reopen it.
"""

import logging
import time
from typing import Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.config import settings
from app.matches import MATCHES

log = logging.getLogger("footdata")

WC_MATCHES_URL = "https://api.football-data.org/v4/competitions/WC/matches"

# How long a successful fetch is considered fresh. The frontend polls every
# ~10s; matching that keeps us at ~6 req/min, safely under the 10/min limit.
CACHE_TTL_SECONDS = 10.0

# football-data.org team name -> our team name. Only the names that differ
# from ours need an entry; everything else matches verbatim. (Verified by
# diffing both 48-team group-stage lists.)
TEAM_ALIASES = {
    "Bosnia-Herzegovina": "Bosnia and Herzegovina",
    "Cape Verde Islands": "Cape Verde",
    "Czechia": "Czech Republic",
    "Congo DR": "DR Congo",
    "South Korea": "Korea Republic",
}


def _our_name(api_name: str) -> str:
    return TEAM_ALIASES.get(api_name, api_name)


# Lookup of our group-stage matches keyed by the ordered (home, away) pair.
# Knockout matches use slot labels until the bracket resolves, so they aren't
# mappable by team name yet — handled best-effort once real names appear.
_PAIR_INDEX = {(m["a"], m["b"]): m["n"] for m in MATCHES if m["s"] == 1}


def _map_to_match_n(home: str, away: str):
    """Return (match_n, flip) for an API home/away pair, or (None, False).

    `flip` is True when the API listed the fixture with home/away reversed
    relative to our data — the caller must then swap the scores so they line
    up with our `a`/`b` orientation.
    """
    h, a = _our_name(home), _our_name(away)
    if (h, a) in _PAIR_INDEX:
        return _PAIR_INDEX[(h, a)], False
    if (a, h) in _PAIR_INDEX:
        return _PAIR_INDEX[(a, h)], True
    return None, False


# Statuses where a (possibly partial) score is meaningful.
_LIVE_STATUSES = {"IN_PLAY", "PAUSED"}
_DONE_STATUSES = {"FINISHED"}


def _extract_score(score: dict):
    """Current home/away goals from an API score block, or (None, None)."""
    for key in ("fullTime", "regularTime", "halfTime"):
        block = score.get(key) or {}
        if block.get("home") is not None and block.get("away") is not None:
            return block["home"], block["away"]
    return None, None


# ── module-level cache ───────────────────────────────────────────────────────
# Sentinel far in the "past" on the monotonic clock (which starts near 0 on a
# fresh process) so the very first request after a cold start always syncs
# instead of being swallowed by the TTL gate for the first ~10s.
_last_sync_ts: float = -1e9


async def sync_live_from_api(db: AsyncSession) -> None:
    """Best-effort: pull WC scores and upsert them into live_matches.

    No-op when the API key is unset or the cache is still warm. Never raises.
    """
    global _last_sync_ts

    if not settings.football_data_api_key:
        return

    now = time.monotonic()
    if now - _last_sync_ts < CACHE_TTL_SECONDS:
        return
    # Mark the attempt up front so a slow/failing call doesn't let a stampede
    # of concurrent polls each fire their own request.
    _last_sync_ts = now

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                WC_MATCHES_URL,
                headers={"X-Auth-Token": settings.football_data_api_key},
            )
        resp.raise_for_status()
        matches = resp.json().get("matches", [])
    except Exception as exc:  # network error, rate limit, bad JSON, etc.
        log.warning("football-data sync failed: %s", exc)
        return

    try:
        finalized = await crud.get_all_results(db)  # match_n -> result tuple
    except Exception as exc:
        log.warning("could not load results for live sync: %s", exc)
        finalized = {}

    for m in matches:
        status = m.get("status")
        if status not in _LIVE_STATUSES and status not in _DONE_STATUSES:
            continue  # TIMED / SCHEDULED / POSTPONED / CANCELLED — nothing to write

        match_n, flip = _map_to_match_n(
            m["homeTeam"]["name"], m["awayTeam"]["name"]
        )
        if match_n is None:
            continue  # unmapped (knockout slot not yet resolved)
        if match_n in finalized:
            continue  # admin finalized this match — leave it locked

        sa, sb = _extract_score(m.get("score") or {})
        if sa is None:
            continue
        if flip:
            sa, sb = sb, sa

        minute = m.get("minute")
        try:
            minute = int(minute) if minute is not None else None
        except (TypeError, ValueError):
            minute = None

        is_live = status in _LIVE_STATUSES

        try:
            await crud.upsert_live_match(
                db, match_n,
                score_a=sa, score_b=sb,
                minute=minute, is_live=is_live,
            )
        except Exception as exc:
            log.warning("upsert_live_match failed for #%s: %s", match_n, exc)
