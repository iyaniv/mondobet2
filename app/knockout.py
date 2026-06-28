"""Resolve knockout bracket slot labels to real team names — backend port.

The static knockout fixtures in `app/matches.py` carry slot placeholders
("1st A", "3rd A/B/C/D/F", "W M73") instead of team names; the real teams are
derived from group results once the standings are known. The frontend already
does this (src/App.jsx: computeGroupStandings / getThirdSlotAssignment /
resolveTeamDeep) so the UI can display "1st A" → "Mexico".

The live-score sync needs the same resolution so it can map a knockout fixture
the live feed reports (e.g. "Mexico vs USA") onto our match number AND know
which side is our `a` column vs `b` column. This module is a FAITHFUL port of
that frontend logic — kept verbatim-equivalent (same simplified tiebreaker,
same FIFA best-3rd table) so backend and UI never disagree about who occupies a
bracket slot.

Resolution is read-only and pure: it only reads finalized group `results`. If a
slot can't be resolved yet (group not finished, bracket TBD), the original label
is returned unchanged — callers detect that via `REAL_TEAMS` membership and skip
the match, so an unresolved or wrong resolution degrades to "no auto-sync"
rather than a bad write.
"""

import re
from typing import Optional

from app.matches import MATCHES, MATCH_INDEX, TEAMS

# Real group-stage country names. A resolved knockout slot must land on one of
# these; anything else (still a slot label) means "not resolvable yet".
REAL_TEAMS = set(TEAMS)

# ── FIFA WC 2026 official 3rd-place slot assignments (mirrors App.jsx) ─────────
# Key = sorted qualifying 8-group letters; value = group assigned to each of the
# eight "3rd X/Y/Z" slots, in FIFA_THIRD_SLOT_LABELS order.
FIFA_THIRD_TABLE = {
    "BDEFIJKL": ["E", "J", "B", "D", "I", "F", "L", "K"],
}
FIFA_THIRD_SLOT_LABELS = [
    "3rd C/E/F/H/I", "3rd E/F/G/I/J", "3rd B/E/F/I/J", "3rd A/B/C/D/F",
    "3rd A/E/H/I/J", "3rd C/D/F/G/H", "3rd D/E/I/J/L", "3rd E/H/I/J/K",
]

_ALL_GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]

_RANK_RE = re.compile(r"^(1st|2nd|3rd)\s+([A-L])$")
_BEST3_RE = re.compile(r"^Best 3rd \((\d+)\)$")
_MULTI3_RE = re.compile(r"^3rd [A-L](/[A-L])+$")
_WL_RE = re.compile(r"^([WL]) M(\d+)$")


def _has_score(results: dict, n: int) -> bool:
    r = results.get(n)
    return bool(r) and r[0] is not None and r[1] is not None


def compute_group_standings(group_letter: str, results: dict) -> list:
    """Group table sorted by the SAME simplified tiebreaker the UI uses:
    Pts, then GD, then GF, then name (ascending). Mirrors App.jsx
    computeGroupStandings; only finalized results are folded in."""
    gm = [m for m in MATCHES if m["s"] == 1 and m["g"] == group_letter]
    teams: list = []
    for m in gm:
        for t in (m["a"], m["b"]):
            if t not in teams:
                teams.append(t)
    s = {t: {"name": t, "P": 0, "W": 0, "D": 0, "L": 0,
             "GF": 0, "GA": 0, "GD": 0, "Pts": 0} for t in teams}
    for m in gm:
        if not _has_score(results, m["n"]):
            continue
        r = results[m["n"]]
        ga, gb = int(r[0]), int(r[1])
        a, b = s[m["a"]], s[m["b"]]
        a["P"] += 1
        b["P"] += 1
        a["GF"] += ga; a["GA"] += gb; a["GD"] = a["GF"] - a["GA"]
        b["GF"] += gb; b["GA"] += ga; b["GD"] = b["GF"] - b["GA"]
        if ga > gb:
            a["W"] += 1; a["Pts"] += 3; b["L"] += 1
        elif gb > ga:
            b["W"] += 1; b["Pts"] += 3; a["L"] += 1
        else:
            a["D"] += 1; a["Pts"] += 1; b["D"] += 1; b["Pts"] += 1
    standings = list(s.values())
    standings.sort(key=lambda t: (-t["Pts"], -t["GD"], -t["GF"], t["name"]))
    return standings


def get_third_slot_assignment(results: dict) -> Optional[dict]:
    """One-to-one map of "3rd X/Y/Z" slot label -> team name, or None if any
    group is still undecided. Uses the FIFA official table when the qualifying
    set of groups matches, else the greedy fallback (mirrors App.jsx)."""
    all_thirds: list = []
    for g in _ALL_GROUPS:
        gm = [m for m in MATCHES if m["s"] == 1 and m["g"] == g]
        if not gm:
            continue
        if not all(_has_score(results, m["n"]) for m in gm):
            return None  # a group isn't fully decided yet
        standings = compute_group_standings(g, results)
        if len(standings) > 2:
            third = dict(standings[2])
            third["group"] = g
            all_thirds.append(third)
    if not all_thirds:
        return None
    all_thirds.sort(key=lambda t: (-t["Pts"], -t["GD"], -t["GF"], t["name"]))
    top8_groups = [t["group"] for t in all_thirds[:8]]
    group_to_team = {t["group"]: t["name"] for t in all_thirds}
    qual_key = "".join(sorted(top8_groups))

    assignment: dict = {}
    table_row = FIFA_THIRD_TABLE.get(qual_key)
    if table_row:
        for i, label in enumerate(FIFA_THIRD_SLOT_LABELS):
            grp = table_row[i]
            if grp and grp in group_to_team:
                assignment[label] = group_to_team[grp]
        return assignment

    # Greedy fallback for combinations not in the lookup table (mirrors App.jsx):
    # assign the most-constrained slot first.
    top8 = set(top8_groups)
    slot_defs: list = []
    seen_slots: set = set()
    for m in MATCHES:
        for side in ("a", "b"):
            val = m[side]
            if (isinstance(val, str) and _MULTI3_RE.match(val)
                    and val not in seen_slots):
                seen_slots.add(val)
                groups = [g for g in val[4:].split("/") if g in top8]
                slot_defs.append({"slot": val, "groups": groups})
    used_groups: set = set()
    for _ in range(len(slot_defs)):
        unassigned = [s for s in slot_defs if s["slot"] not in assignment]
        if not unassigned:
            break
        unassigned.sort(
            key=lambda s: len([g for g in s["groups"] if g not in used_groups])
        )
        slot = unassigned[0]
        available = [g for g in slot["groups"] if g not in used_groups]
        best = next((t for t in all_thirds if t["group"] in available), None)
        assignment[slot["slot"]] = group_to_team[best["group"]] if best else None
        if best:
            used_groups.add(best["group"])
    return assignment


def resolve_team(name, results: dict, depth: int = 0):
    """Resolve a bracket slot label to a real team name using finalized group
    results, recursing through earlier knockout rounds. Returns the label
    unchanged if it can't be resolved yet. Faithful port of App.jsx
    resolveTeamDeep."""
    if depth > 8 or not isinstance(name, str):
        return name

    # Group-rank slots: "1st A", "2nd B", "3rd C"
    m = _RANK_RE.match(name)
    if m:
        rank = {"1st": 0, "2nd": 1, "3rd": 2}[m.group(1)]
        g = m.group(2)
        gm = [x for x in MATCHES if x["s"] == 1 and x["g"] == g]
        if not gm:
            return name
        if not all(_has_score(results, x["n"]) for x in gm):
            return name
        standings = compute_group_standings(g, results)
        return standings[rank]["name"] if rank < len(standings) else name

    # "Best 3rd (N)" — Nth best 3rd-place team across all groups
    m = _BEST3_RE.match(name)
    if m:
        idx = int(m.group(1)) - 1
        all_thirds: list = []
        for g in _ALL_GROUPS:
            gm = [x for x in MATCHES if x["s"] == 1 and x["g"] == g]
            if not gm:
                continue
            if not all(_has_score(results, x["n"]) for x in gm):
                return name
            standings = compute_group_standings(g, results)
            if len(standings) > 2:
                all_thirds.append(standings[2])
        if not all_thirds:
            return name
        all_thirds.sort(key=lambda t: (-t["Pts"], -t["GD"], -t["GF"], t["name"]))
        return all_thirds[idx]["name"] if idx < len(all_thirds) else name

    # Multi-group 3rd-place slots: "3rd A/B/C/D/F"
    if _MULTI3_RE.match(name):
        assignment = get_third_slot_assignment(results)
        if not assignment:
            return name
        return assignment.get(name) or name

    # Knockout winner/loser slots: "W M73" / "L M101"
    m = _WL_RE.match(name)
    if not m:
        return name  # already a real team
    typ, n = m.group(1), int(m.group(2))
    src = MATCH_INDEX.get(n)
    if not src:
        return name
    team_a = resolve_team(src["a"], results, depth + 1)
    team_b = resolve_team(src["b"], results, depth + 1)
    res = results.get(n)
    if not res:
        return name
    sa, sb = res[0], res[1]
    winner = res[2] if len(res) > 2 else None
    if sa is None or sb is None:
        return name
    w = winner or ("a" if sa > sb else "b" if sb > sa else None)
    if not w:
        return name  # tie with no decided winner — bracket TBD
    if typ == "W":
        return team_a if w == "a" else team_b
    return team_b if w == "a" else team_a


def build_pair_index(results: dict) -> dict:
    """Map (home_team, away_team) -> match_n for every fixture we can place.

    Group-stage fixtures use their static names; knockout fixtures use names
    resolved from `results`, and are only included once BOTH sides resolve to a
    real team (`REAL_TEAMS`). The orientation stored here is our (a, b) order,
    so the live-sync's existing home/away flip logic lines scores up correctly.
    """
    index: dict = {}
    for m in MATCHES:
        if m["s"] == 1:
            index[(m["a"], m["b"])] = m["n"]
        else:
            a = resolve_team(m["a"], results)
            b = resolve_team(m["b"], results)
            if a in REAL_TEAMS and b in REAL_TEAMS:
                index[(a, b)] = m["n"]
    return index
