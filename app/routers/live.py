from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import require_admin
from app.database import get_db
from app.matches import MATCH_INDEX
from app.schemas import LiveMatchIn, LiveMatchOut

router = APIRouter(prefix="/live", tags=["live"])


@router.get("/", response_model=list[LiveMatchOut])
async def list_live(db: AsyncSession = Depends(get_db)):
    live = await crud.get_live_matches(db)
    return [LiveMatchOut(match_n=n, **v) for n, v in live.items()]


@router.put("/{match_n}", response_model=LiveMatchOut)
async def set_live(
    match_n: int,
    data: LiveMatchIn,
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if match_n not in MATCH_INDEX:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found.")
    lm = await crud.upsert_live_match(db, match_n, data.score_a, data.score_b, data.minute)
    return LiveMatchOut(match_n=lm.match_n, score_a=lm.score_a, score_b=lm.score_b, minute=lm.minute)


@router.delete("/{match_n}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_live(
    match_n: int,
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await crud.remove_live_match(db, match_n)


@router.post("/{match_n}/finalize", response_model=LiveMatchOut)
async def finalize_live(
    match_n: int,
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await crud.finalize_live_match(db, match_n)
    if not result:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No live match found.")
    return LiveMatchOut(match_n=match_n, score_a=result.score_a, score_b=result.score_b, minute=0)
