from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import get_current_user, require_admin
from app.database import get_db
from app.schemas import ConfigOut, ConfigUpdate

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/", response_model=ConfigOut)
async def get_config(db: AsyncSession = Depends(get_db)):
    cfg = await crud.get_config(db)
    return ConfigOut(round_state=cfg.round_state.value, tournament_winner=cfg.tournament_winner)


@router.patch("/", response_model=ConfigOut)
async def update_config(data: ConfigUpdate, _=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    cfg = await crud.update_config(db, round_state=data.round_state, tournament_winner=data.tournament_winner)
    return ConfigOut(round_state=cfg.round_state.value, tournament_winner=cfg.tournament_winner)
