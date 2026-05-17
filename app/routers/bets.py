from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.database import get_db
from app.models import ResultEnum
from app.schemas import BetCreate, BetResponse, BetUpdate

router = APIRouter(prefix="/bets", tags=["bets"])


@router.get("/", response_model=list[BetResponse])
async def list_bets(
    player_id: Optional[int] = Query(None, description="Filter by player"),
    result: Optional[ResultEnum] = Query(None, description="Filter by result"),
    db: AsyncSession = Depends(get_db),
):
    bets = await crud.get_bets(db, player_id=player_id, result=result)
    return [BetResponse.from_bet(b) for b in bets]


@router.post("/", response_model=BetResponse, status_code=status.HTTP_201_CREATED)
async def create_bet(data: BetCreate, db: AsyncSession = Depends(get_db)):
    if not await crud.get_player(db, data.player_id):
        raise HTTPException(status_code=404, detail="Player not found.")
    bet = await crud.create_bet(db, data)
    return BetResponse.from_bet(bet)


@router.get("/{bet_id}", response_model=BetResponse)
async def get_bet(bet_id: int, db: AsyncSession = Depends(get_db)):
    bet = await crud.get_bet(db, bet_id)
    if not bet:
        raise HTTPException(status_code=404, detail="Bet not found.")
    return BetResponse.from_bet(bet)


@router.patch("/{bet_id}", response_model=BetResponse)
async def update_bet(bet_id: int, data: BetUpdate, db: AsyncSession = Depends(get_db)):
    """Partial update — send only the fields you want to change."""
    if not await crud.get_bet(db, bet_id):
        raise HTTPException(status_code=404, detail="Bet not found.")
    bet = await crud.update_bet(db, bet_id, data)
    return BetResponse.from_bet(bet)


@router.delete("/{bet_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bet(bet_id: int, db: AsyncSession = Depends(get_db)):
    if not await crud.delete_bet(db, bet_id):
        raise HTTPException(status_code=404, detail="Bet not found.")
