"""ESPN public scoreboard live-score sync — the primary realtime feed.

ESPN's undocumented (but long-stable) public JSON endpoint serves World Cup
scores with **no API key** and near-real-time updates — far fresher than the
football-data.org free tier, which lags several minutes. So this is the primary
realtime source; football-data.org stays as a keyed fallback in footdata.py.

Same contract as footdata: best-effort, never raises, and writes into the same
`live_matches` table the leaderboard + frontend poll already read. Because the
endpoint is unofficial (ESPN can change/remove it without notice), the whole
fetch is wrapped and returns False on any failure so the caller can fall back.

Score handling mirrors footdata exactly:
- Regulation (≤ 2nd half): the running score IS the 90-min score → written to
  score_a/score_b, and FINAL-on-completion auto-finalizes the match.
- Extra time / penalties (knockouts only): the 90-min score is FROZEN (we leave
  score_a/score_b from the regulation syncs untouched) and the evolving total
  goes into et_a/et_b for display only. We do NOT auto-finalize — the admin
  confirms ET/penalty outcomes by hand, exactly like the football-data path.
"""

import logging
from typing import Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.matches import MATCHES

log = logging.getLogger("espn")

# Today's World Cup slate (no `dates` param = current day) — all we need for a
# live feed. Keyless, public.
WC_SCOREBOARD_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"
)

# ESPN team name -> our team name. Only entries that differ from ours are
# listed; everything else matches verbatim. Defensive extras (Türkiye, Curacao,
# Congo DR, Bosnia-Herzegovina) cover spellings that may appear once those teams
# play — an unmapped team simply won't auto-sync (admin can still enter it), so
# a missing alias degrades gracefully rather than breaking.
TEAM_ALIASES = {
    "South Korea": "Korea Republic",
    "Czechia": "Czech Republic",
    "Congo DR": "DR Congo",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina",
    "Türkiye": "Turkey",
    "Turkiye": "Turkey",
    "Curacao": "Curaçao",
    "Cape Verde Islands": "Cape Verde",
}


def _our_name(api_name: str) -> str:
    return TEAM_ALIASES.get(api_name, api_name)


# Group-stage fixtures keyed by ordered (home, away). Knockout slots aren't
# mappable by team name until the bracket resolves — handled best-effort once
# real names appear.
_PAIR_INDEX = {(m["a"], m["b"]): m["n"] for m in MATCHES if m["s"] == 1}


def _map_to_match_n(home: str, away: str):
    """Return (match_n, flip) for an ESPN home/away pair, or (None, False).

    `flip` is True when ESPN lists the fixture reversed vs our a/b orientation,
    so the caller swaps the scores to line up.
    """
    h, a = _our_name(home), _our_name(away)
    if (h, a) in _PAIR_INDEX:
        return _PAIR_INDEX[(h, a)], False
    if (a, h) in _PAIR_INDEX:
        return _PAIR_INDEX[(a, h)], True
    return None, False


def _parse_minute(display_clock, clock) -> Optional[int]:
    """Best-effort current minute. Prefer the leading number of displayClock
    ("90'+2'" -> 90); fall back to clock seconds (5400.0 -> 90)."""
    if display_clock:
        digits = ""
        for ch in str(display_clock):
            if ch.isdigit():
                digits += ch
            else:
                break
        if digits:
            try:
                return int(digits)
            except ValueError:
                pass
    try:
        if clock is not None:
            return int(float(clock) // 60)
    except (TypeError, ValueError):
        pass
    return None


def _is_regulation(period, type_name: str) -> bool:
    """True while the match is still in (or finished within) the 90 minutes.
    Extra time / shootout periods (period >= 3, or an ET/PEN/AET status) are
    NOT regulation."""
    name = (type_name or "").upper()
    if any(k in name for k in ("EXTRA", "SHOOTOUT", "PENAL", "AET")):
        return False
    try:
        if period is not None and int(period) >= 3:
            return False
    except (TypeError, ValueError):
        pass
    return True


# Score blocks worth writing: in-play or finished. "pre" (scheduled) is skipped.
def _extract(event: dict) -> Optional[dict]:
    """Parse one ESPN event into a normalized live record, or None to skip.

    Returns {match_n, score_a, score_b, minute, is_live, is_done, is_regulation}
    with scores already oriented to our a/b. Pure — used by the sync loop and
    directly unit-testable against a saved scoreboard payload.
    """
    comp = (event.get("competitions") or [{}])[0]
    status = comp.get("status") or event.get("status") or {}
    stype = status.get("type") or {}
    state = stype.get("state")
    if state == "pre" or state not in ("in", "post"):
        return None  # scheduled / postponed / canceled — nothing to write

    competitors = comp.get("competitors") or []
    home = next((c for c in competitors if c.get("homeAway") == "home"), None)
    away = next((c for c in competitors if c.get("homeAway") == "away"), None)
    if not home or not away:
        return None

    def _score(c):
        try:
            return int(c.get("score"))
        except (TypeError, ValueError):
            return None

    sa, sb = _score(home), _score(away)
    if sa is None or sb is None:
        return None

    match_n, flip = _map_to_match_n(
        (home.get("team") or {}).get("name", ""),
        (away.get("team") or {}).get("name", ""),
    )
    if match_n is None:
        return None
    if flip:
        sa, sb = sb, sa

    return {
        "match_n": match_n,
        "score_a": sa,
        "score_b": sb,
        "minute": _parse_minute(status.get("displayClock"), status.get("clock")),
        "is_live": state == "in",
        "is_done": state == "post" and bool(stype.get("completed")),
        "is_regulation": _is_regulation(status.get("period"), stype.get("name")),
    }


async def sync_live_from_espn(db: AsyncSession) -> bool:
    """Pull today's WC scores from ESPN and upsert them into live_matches.

    Returns True if the fetch succeeded (so the caller knows not to fall back),
    False on any network/parse failure. Never raises. Assumes the caller has
    already gated on data_source=="realtime" and the shared cache.
    """
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(WC_SCOREBOARD_URL)
        resp.raise_for_status()
        events = resp.json().get("events", [])
    except Exception as exc:  # network error, bad JSON, endpoint moved, etc.
        log.warning("ESPN sync failed: %s", exc)
        return False

    try:
        finalized = await crud.get_all_results(db)  # match_n -> result tuple
    except Exception as exc:
        log.warning("could not load results for ESPN sync: %s", exc)
        finalized = {}

    for event in events:
        try:
            rec = _extract(event)
        except Exception as exc:
            log.warning("ESPN parse failed for an event: %s", exc)
            continue
        if rec is None:
            continue
        if rec["match_n"] in finalized:
            continue  # admin finalized this match — leave it locked

        try:
            if rec["is_regulation"]:
                # Running score IS the 90-min score; track it live and finalize
                # (move to results = FINAL, locked) at full time.
                await crud.upsert_live_match(
                    db, rec["match_n"],
                    score_a=rec["score_a"], score_b=rec["score_b"],
                    minute=rec["minute"], is_live=rec["is_live"],
                )
                if rec["is_done"]:
                    await crud.finalize_live_match(db, rec["match_n"])
            else:
                # ET / penalties (knockouts only): FREEZE the 90-min score
                # (score_a/score_b left untouched from the regulation syncs) and
                # write the evolving total into et_a/et_b for display. Points
                # stay pegged to the 90-min score; admin confirms the final.
                await crud.upsert_live_match(
                    db, rec["match_n"],
                    minute=rec["minute"], is_live=rec["is_live"],
                    et_a=rec["score_a"], et_b=rec["score_b"],
                )
        except Exception as exc:
            log.warning("ESPN live write failed for #%s: %s", rec["match_n"], exc)

    return True
