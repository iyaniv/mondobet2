from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import get_current_user
from app.database import get_db, AsyncSessionLocal
from app.models import DailyRankSnapshot
from app.schemas import LeaderboardEntry, SimulateRequest

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])

CT = ZoneInfo("America/Chicago")


async def _snapshot_today(rows: list[LeaderboardEntry]) -> None:
    """Write today's snapshot in a fresh session (runs as a background task)."""
    async with AsyncSessionLocal() as db:
        await crud.save_daily_snapshot(db, rows)


async def _maybe_save_today_snapshot(
    rows: list[LeaderboardEntry],
    db: AsyncSession,
    background_tasks: BackgroundTasks,
) -> None:
    today = datetime.now(CT).date()
    r = await db.execute(
        select(DailyRankSnapshot.id).where(DailyRankSnapshot.snapshot_date == today).limit(1)
    )
    if r.scalar_one_or_none() is None:
        background_tasks.add_task(_snapshot_today, list(rows))


@router.get("/", response_model=list[LeaderboardEntry])
async def get_leaderboard(
    background_tasks: BackgroundTasks,
    _=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await crud.get_leaderboard(db)
    await _maybe_save_today_snapshot(rows, db, background_tasks)
    return rows


@router.get("/snapshot")
async def get_rank_snapshot(
    _=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Last 5 CT-day snapshots keyed by ISO date: {'2026-06-17': {entry_id: rank}}."""
    return await crud.get_daily_snapshots(db)


@router.post("/simulate", response_model=list[LeaderboardEntry])
async def simulate_leaderboard(
    data: SimulateRequest,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Leaderboard as if every unplayed match finished with the given scores."""
    return await crud.get_leaderboard(
        db, sim_results=data.results, sim_winner=data.winner, sim_user_id=user.id
    )
