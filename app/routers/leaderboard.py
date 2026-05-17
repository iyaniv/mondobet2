from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import get_current_user
from app.database import get_db
from app.schemas import LeaderboardEntry

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])


@router.get("/", response_model=list[LeaderboardEntry])
async def get_leaderboard(_=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await crud.get_leaderboard(db)
