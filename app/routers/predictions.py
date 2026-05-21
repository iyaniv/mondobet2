from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import get_current_user
from app.database import get_db
from app.matches import MATCH_INDEX
from app.models import RoundStateEnum
from app.schemas import PredictionIn, PredictionOut, WinnerPickIn

router = APIRouter(prefix="/predictions", tags=["predictions"])


async def _resolve_entry(entry_id: Optional[str], user, db):
    """Return the entry to operate on, or raise if not found / not owned."""
    if entry_id:
        entry = await crud.get_entry(db, entry_id)
        if not entry or entry.user_id != user.id:
            raise HTTPException(404, "Entry not found.")
        return entry
    # No entry_id: default to first draft, else last entry
    entries = await crud.get_user_entries(db, user.id)
    if not entries:
        raise HTTPException(400, "No entries found. Create an entry first.")
    draft = next((e for e in entries if e.submitted_at is None), None)
    return draft or entries[-1]


@router.get("/me", response_model=list[PredictionOut])
async def my_predictions(
    entry_id: Optional[str] = Query(None),
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = await _resolve_entry(entry_id, user, db)
    preds = await crud.get_entry_predictions(db, entry.id)
    return [PredictionOut(match_n=n, score_a=v[0], score_b=v[1]) for n, v in preds.items()]


@router.put("/{match_n}", response_model=PredictionOut)
async def set_prediction(
    match_n: int,
    data: PredictionIn,
    entry_id: Optional[str] = Query(None),
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if match_n not in MATCH_INDEX:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found.")
    cfg = await crud.get_config(db)
    if cfg.round_state != RoundStateEnum.open:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Betting round is not open.")
    entry = await _resolve_entry(entry_id, user, db)
    if entry.submitted_at is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Entry already submitted.")
    pred = await crud.upsert_prediction(db, entry.id, match_n, data.score_a, data.score_b)
    return PredictionOut(match_n=pred.match_n, score_a=pred.score_a, score_b=pred.score_b)


@router.put("/winner/me", response_model=dict)
async def set_winner_pick(
    data: WinnerPickIn,
    entry_id: Optional[str] = Query(None),
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cfg = await crud.get_config(db)
    if cfg.round_state != RoundStateEnum.open:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Betting round is not open.")
    # Locked winner always overrides the request body
    team = user.locked_winner if user.locked_winner is not None else data.team
    entry = await _resolve_entry(entry_id, user, db)
    if entry.submitted_at is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Entry already submitted.")
    await crud.upsert_winner_pick(db, entry.id, team)
    return {"team": team, "locked": user.locked_winner is not None}


@router.get("/user/{user_id}", response_model=list[PredictionOut])
async def user_predictions(
    user_id: int,
    entry_id: Optional[str] = Query(None),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin always, participants only when round is closed."""
    if not current_user.is_admin:
        cfg = await crud.get_config(db)
        if cfg.round_state != RoundStateEnum.closed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not available until round is closed.")
    if entry_id:
        preds = await crud.get_entry_predictions(db, entry_id)
    else:
        entries = await crud.get_user_entries(db, user_id)
        submitted = [e for e in entries if e.submitted_at is not None]
        if not submitted:
            return []
        preds = await crud.get_entry_predictions(db, submitted[0].id)
    return [PredictionOut(match_n=n, score_a=v[0], score_b=v[1]) for n, v in preds.items()]
