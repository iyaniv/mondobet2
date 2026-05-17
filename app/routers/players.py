from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.database import get_db
from app.schemas import PlayerCreate, PlayerResponse, PlayerStats

router = APIRouter(prefix="/players", tags=["players"])


@router.get("/", response_model=list[PlayerResponse])
async def list_players(db: AsyncSession = Depends(get_db)):
    return await crud.get_players(db)


@router.post("/", response_model=PlayerResponse, status_code=status.HTTP_201_CREATED)
async def create_player(data: PlayerCreate, db: AsyncSession = Depends(get_db)):
    if await crud.get_player_by_name(db, data.name.strip()):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Player '{data.name}' already exists.",
        )
    return await crud.create_player(db, data)


@router.get("/{player_id}", response_model=PlayerResponse)
async def get_player(player_id: int, db: AsyncSession = Depends(get_db)):
    player = await crud.get_player(db, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found.")
    return player


@router.delete("/{player_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_player(player_id: int, db: AsyncSession = Depends(get_db)):
    if not await crud.delete_player(db, player_id):
        raise HTTPException(status_code=404, detail="Player not found.")


@router.get("/{player_id}/stats", response_model=PlayerStats)
async def get_player_stats(player_id: int, db: AsyncSession = Depends(get_db)):
    """Score stats for one player: profit, win rate, W/L counts, etc."""
    player = await crud.get_player(db, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found.")
    return crud.calculate_player_stats(player, list(player.bets))
