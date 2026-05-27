from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import get_current_user
from app.database import get_db
from app.schemas import LeaderboardEntry, SimulateRequest

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])


@router.get("/", response_model=list[LeaderboardEntry])
async def get_leaderboard(_=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await crud.get_leaderboard(db)


@router.post("/simulate", response_model=list[LeaderboardEntry])
async def simulate_leaderboard(
    data: SimulateRequest,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Leaderboard as if every unplayed match finished with the given scores.

    While the round is open, the simulation applies only to the requesting
    user's own forms (others' open-stage predictions stay hidden).
    """
    return await crud.get_leaderboard(
        db, sim_results=data.results, sim_winner=data.winner, sim_user_id=user.id
    )
