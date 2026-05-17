"""
Scoring logic — direct port of matchScore() and userTotals() from wc2026-demo.html.

  matchScore:
    correct direction (win/draw/loss)  →  5 pts
    exact score (both correct)         →  +3 pts
    partial (one side correct)         →  +1 pt
    maximum per match                  →  8 pts

  userTotals:
    sum of matchScore over all settled matches
    +10 if winner pick == tournament winner
"""


def _sign(x: int) -> int:
    return 0 if x == 0 else (1 if x > 0 else -1)


def match_score(
    pred: list[int | None] | None,
    real: list[int | None] | None,
) -> dict:
    """Return {dir, exact, total} for one match."""
    if (
        not pred or not real
        or pred[0] is None or pred[1] is None
        or real[0] is None or real[1] is None
    ):
        return {"dir": 0, "exact": 0, "total": 0}

    p1, p2 = int(pred[0]), int(pred[1])
    r1, r2 = int(real[0]), int(real[1])

    dir_pts = 5 if _sign(p1 - p2) == _sign(r1 - r2) else 0
    exact = 0
    if p1 == r1 and p2 == r2:
        exact = 3
    elif p1 == r1 or p2 == r2:
        exact = 1

    return {"dir": dir_pts, "exact": exact, "total": dir_pts + exact}


def user_totals(
    predictions: dict[int, list[int | None]],   # {match_n: [a, b]}
    results: dict[int, list[int]],               # {match_n: [a, b]}
    winner_pick: str | None,
    tournament_winner: str | None,
) -> dict:
    """Return aggregate scoring stats for one user."""
    total = 0
    exact_count = 0
    correct_dir = 0
    scored_matches = 0

    for match_n, real in results.items():
        pred = predictions.get(match_n)
        s = match_score(pred, real)
        total += s["total"]
        if s["exact"] == 3:
            exact_count += 1
        if s["dir"] == 5:
            correct_dir += 1
        if s["total"] > 0 or (pred and pred[0] is not None):
            scored_matches += 1

    winner_bonus = 10 if (tournament_winner and winner_pick == tournament_winner) else 0

    return {
        "total": total + winner_bonus,
        "exact": exact_count,
        "correct_dir": correct_dir,
        "scored_matches": scored_matches,
        "winner_pick": winner_pick,
        "winner_bonus": winner_bonus,
    }
