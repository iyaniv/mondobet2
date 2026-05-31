from __future__ import annotations
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
from app.matches import MATCHES, STAGES, TEAMS
from app.models import Prediction, User, WinnerPick

router = APIRouter(prefix="/init", tags=["init"])
_bearer = HTTPBearer(auto_error=False)


@router.get("/")
async def bootstrap(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
):
    caller: User | None = None
    if credentials:
        uid = decode_token(credentials.credentials)
        if uid:
            caller = await db.get(User, uid)

    cfg          = await crud.get_config(db)
    results_map  = await crud.get_all_results(db)
    live_map     = await crud.get_live_matches(db)
    lb           = await crud.get_leaderboard(db)

    out: dict = {
        "matches": MATCHES,
        "teams": TEAMS,
        "stages": STAGES,
        "config": {
            "round_state": cfg.round_state.value,
            "tournament_winner": cfg.tournament_winner,
            "data_source": cfg.data_source,
            "current_stage": getattr(cfg, "current_stage", 1),
        },
        "results": [
            {"match_n": n, "score_a": v[0], "score_b": v[1], "winner": v[2],
             "et_a": v[3], "et_b": v[4], "pen_a": v[5], "pen_b": v[6]}
            for n, v in results_map.items()
        ],
        "live": [
            {"match_n": n, "score_a": v["score_a"], "score_b": v["score_b"],
             "minute": v["minute"], "is_live": bool(v.get("is_live")),
             "winner": v.get("winner"),
             "et_a": v.get("et_a"), "et_b": v.get("et_b"),
             "pen_a": v.get("pen_a"), "pen_b": v.get("pen_b")}
            for n, v in live_map.items()
        ],
        "leaderboard": [e.model_dump() for e in lb],
    }

    if caller and not caller.is_admin:
        entries = await crud.get_user_entries(db, caller.id)
        entry_ids = [e.id for e in entries]

        # Batch-fetch all predictions and winner picks for this user's entries
        # (2 queries regardless of how many entries the user has)
        preds_rows = (await db.execute(
            select(Prediction).where(Prediction.entry_id.in_(entry_ids))
        )).scalars().all()
        preds_by_entry: dict = {}
        for p in preds_rows:
            preds_by_entry.setdefault(p.entry_id, {})[p.match_n] = [p.score_a, p.score_b]

        wp_rows = (await db.execute(
            select(WinnerPick).where(WinnerPick.entry_id.in_(entry_ids))
        )).scalars().all()
        wp_by_entry = {wp.entry_id: wp.team for wp in wp_rows}

        entries_data = []
        for entry in entries:
            preds = preds_by_entry.get(entry.id, {})
            entries_data.append({
                "id": entry.id,
                "name": entry.name,
                "created_at": entry.created_at.isoformat(),
                "submitted_at": entry.submitted_at.isoformat() if entry.submitted_at else None,
                "stages_submitted": entry.stages_submitted or {},
                "predictions": [
                    {"match_n": n, "score_a": v[0], "score_b": v[1]}
                    for n, v in preds.items()
                ],
                "winner_pick": wp_by_entry.get(entry.id),
            })
        out["entries"] = entries_data
        out["locked_winner"] = caller.locked_winner
        # Backward-compat: expose first submitted entry's data at the top level
        submitted = [e for e in entries_data if e["submitted_at"]]
        first = submitted[0] if submitted else (entries_data[0] if entries_data else None)
        if first:
            out["my_predictions"] = first["predictions"]
            out["my_winner_pick"] = first["winner_pick"]

    if caller and caller.is_admin:
        participants = await crud.get_participants_with_entries(db)
        out["participants"] = participants
        # Keep backward-compat "users" key pointing to flat list
        out["users"] = [
            {"id": p["id"], "name": p["name"], "email": p["email"],
             "is_admin": False, "has_paid": p["has_paid"],
             "locked_winner": p.get("locked_winner")}
            for p in participants
        ]

    return out
