from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import get_current_user
from app.database import get_db
from app.matches import MATCH_INDEX
from app.models import RoundStateEnum
from app.schemas import PredictionIn, PredictionOut, WinnerPickIn

router = APIRouter(prefix="/predictions", tags=["predictions"])


@router.get("/me", response_model=list[PredictionOut])
async def my_predictions(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    preds = await crud.get_user_predictions(db, user.id)
    return [PredictionOut(match_n=n, score_a=v[0], score_b=v[1]) for n, v in preds.items()]


@router.put("/{match_n}", response_model=PredictionOut)
async def set_prediction(
    match_n: int,
    data: PredictionIn,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if match_n not in MATCH_INDEX:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found.")
    cfg = await crud.get_config(db)
    if cfg.round_state != RoundStateEnum.open:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Betting round is not open.")
    pred = await crud.upsert_prediction(db, user.id, match_n, data.score_a, data.score_b)
    return PredictionOut(match_n=pred.match_n, score_a=pred.score_a, score_b=pred.score_b)


@router.put("/winner/me", response_model=dict)
async def set_winner_pick(
    data: WinnerPickIn,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cfg = await crud.get_config(db)
    if cfg.round_state != RoundStateEnum.open:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Betting round is not open.")
    await crud.upsert_winner_pick(db, user.id, data.team)
    return {"team": data.team}


@router.get("/user/{user_id}", response_model=list[PredictionOut])
async def user_predictions(
    user_id: int,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin can always view. Participants can view only when round is closed."""
    if not current_user.is_admin:
        cfg = await crud.get_config(db)
        if cfg.round_state != RoundStateEnum.closed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not available until round is closed.")
    preds = await crud.get_user_predictions(db, user_id)
    return [PredictionOut(match_n=n, score_a=v[0], score_b=v[1]) for n, v in preds.items()]
