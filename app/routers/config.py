from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import require_admin
from app.database import get_db
from app.schemas import ConfigOut, ConfigUpdate

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/", response_model=ConfigOut)
async def get_config(db: AsyncSession = Depends(get_db)):
    cfg = await crud.get_config(db)
    return ConfigOut(round_state=cfg.round_state.value, tournament_winner=cfg.tournament_winner)


@router.patch("/", response_model=ConfigOut)
async def update_config(data: ConfigUpdate, _=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    # Use model_fields_set to distinguish "not sent" from "explicitly set to null".
    # This is the only correct way to tell apart:
    #   {}                          → don't touch tournament_winner
    #   {"tournament_winner": null} → clear it
    #   {"tournament_winner": "Brazil"} → set it
    kwargs = {}
    if "round_state" in data.model_fields_set:
        kwargs["round_state"] = data.round_state
    if "tournament_winner" in data.model_fields_set:
        kwargs["tournament_winner"] = data.tournament_winner  # may be None

    cfg = await crud.update_config(db, **kwargs)
    return ConfigOut(round_state=cfg.round_state.value, tournament_winner=cfg.tournament_winner)
