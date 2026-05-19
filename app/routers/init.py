"""
Single-request bootstrap — returns everything the client needs on load.
Replaces 4-5 parallel API calls with one DB session.
"""
from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import decode_token
from app.database import get_db
from app.matches import MATCHES, TEAMS
from app.models import User, WinnerPick

router = APIRouter(prefix="/init", tags=["init"])
_bearer = HTTPBearer(auto_error=False)


@router.get("/")
async def bootstrap(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
):
    # Resolve caller if a valid JWT was supplied (optional auth)
    caller: User | None = None
    if credentials:
        uid = decode_token(credentials.credentials)
        if uid:
            caller = await db.get(User, uid)

    # Bulk-load everything in one session
    cfg          = await crud.get_config(db)
    results_map  = await crud.get_all_results(db)
    live_map     = await crud.get_live_matches(db)
    lb           = await crud.get_leaderboard(db)

    out: dict = {
        "matches":     MATCHES,
        "teams":       TEAMS,
        "config": {
            "round_state":      cfg.round_state.value,
            "tournament_winner": cfg.tournament_winner,
        },
        "results": [
            {"match_n": n, "score_a": v[0], "score_b": v[1]}
            for n, v in results_map.items()
        ],
        "live": [
            {"match_n": n, "score_a": v["score_a"],
             "score_b": v["score_b"], "minute": v["minute"]}
            for n, v in live_map.items()
        ],
        "leaderboard": [e.model_dump() for e in lb],
    }

    if caller and not caller.is_admin:
        preds = await crud.get_user_predictions(db, caller.id)
        out["my_predictions"] = [
            {"match_n": n, "score_a": v[0], "score_b": v[1]}
            for n, v in preds.items()
        ]
        wp = (await db.execute(
            select(WinnerPick).where(WinnerPick.user_id == caller.id)
        )).scalar_one_or_none()
        out["my_winner_pick"] = wp.team if wp else None

    if caller and caller.is_admin:
        users = await crud.get_participants(db)
        out["users"] = [
            {"id": u.id, "name": u.name, "email": u.email,
             "is_admin": u.is_admin, "has_paid": u.has_paid}
            for u in users
        ]

    return out
