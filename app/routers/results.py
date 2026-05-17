from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import require_admin
from app.database import get_db
from app.matches import MATCH_INDEX
from app.schemas import ResultIn, ResultOut

router = APIRouter(prefix="/results", tags=["results"])


@router.get("/", response_model=list[ResultOut])
async def list_results(db: AsyncSession = Depends(get_db)):
    results = await crud.get_all_results(db)
    return [ResultOut(match_n=n, score_a=v[0], score_b=v[1]) for n, v in results.items()]


@router.put("/{match_n}", response_model=dict)
async def set_result(
    match_n: int,
    data: ResultIn,
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if match_n not in MATCH_INDEX:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found.")
    await crud.upsert_result(db, match_n, data.score_a, data.score_b)
    return {"match_n": match_n, "score_a": data.score_a, "score_b": data.score_b}
