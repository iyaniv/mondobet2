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
    """Save / update a prediction.

    Users can keep editing predictions for the CURRENT open stage until that
    stage's matches have a real result or admin marks them live. Editing
    after Submit is allowed — it invalidates THIS stage's submission flag
    on the entry, so the user has to click Submit again to re-confirm.
    """
    match = MATCH_INDEX.get(match_n)
    if not match:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found.")
    cfg = await crud.get_config(db)
    if cfg.round_state != RoundStateEnum.open:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Betting round is not open.")
    # Only current-stage matches are editable. Past stages stay locked,
    # future ones aren't open yet.
    match_stage = match.get("s") if isinstance(match, dict) else getattr(match, "s", None)
    if match_stage != cfg.current_stage:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This stage is closed for predictions.")
    # Defence in depth: if admin already entered a result or live score for
    # this match, the user can't re-predict it.
    results_map = await crud.get_all_results(db)
    if match_n in results_map:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Match already has a result.")
    live_map = await crud.get_live_matches(db)
    if match_n in live_map:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Match is live — cannot edit.")
    entry = await _resolve_entry(entry_id, user, db)
    pred = await crud.upsert_prediction(db, entry.id, match_n, data.score_a, data.score_b)
    # Editing invalidates this stage's submission — user must re-Submit.
    stages = dict(entry.stages_submitted or {})
    if str(match_stage) in stages:
        del stages[str(match_stage)]
        entry.stages_submitted = stages
        await db.commit()
    return PredictionOut(match_n=pred.match_n, score_a=pred.score_a, score_b=pred.score_b)


@router.put("/winner/me", response_model=dict)
async def set_winner_pick(
    data: WinnerPickIn,
    entry_id: Optional[str] = Query(None),
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set / change the tournament winner pick for the active entry.

    Editable while stage 1 is still the current open stage. Once admin
    advances `current_stage` past 1, the pick is locked.
    """
    cfg = await crud.get_config(db)
    if cfg.round_state != RoundStateEnum.open:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Betting round is not open.")
    if (cfg.current_stage or 1) > 1:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Winner pick locked — stage 1 has closed.")
    entry = await _resolve_entry(entry_id, user, db)
    await crud.upsert_winner_pick(db, entry.id, data.team)
    locked = (cfg.current_stage or 1) > 1
    return {"team": data.team, "locked": locked}


@router.get("/user/{user_id}", response_model=list[PredictionOut])
async def user_predictions(
    user_id: int,
    entry_id: Optional[str] = Query(None),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return predictions:
    - Admin or own entry: all predictions.
    - Other user's submitted entry: all predictions (publicly visible after submit).
    - Other user's unsubmitted entry: nothing.
    """
    if entry_id:
        entry = await crud.get_entry(db, entry_id)
        if not entry:
            return []
        preds = await crud.get_entry_predictions(db, entry_id)
    else:
        entries = await crud.get_user_entries(db, user_id)
        submitted = [e for e in entries if e.submitted_at is not None]
        if not submitted:
            return []
        entry = submitted[0]
        preds = await crud.get_entry_predictions(db, entry.id)

    viewing_own = (user_id == current_user.id)
    if current_user.is_admin or viewing_own or entry.submitted_at:
        return [PredictionOut(match_n=n, score_a=v[0], score_b=v[1]) for n, v in preds.items()]
    return []
