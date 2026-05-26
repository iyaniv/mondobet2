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


@router.post("/reset", response_model=dict)
async def reset_all_results(
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin testing helper — wipes every final result AND every live record.

    Predictions, entries, users, winner picks, config and stages are all
    left untouched; only the admin-entered scores go.
    """
    deleted = await crud.delete_all_results_and_live(db)
    return {"deleted": deleted}


@router.post("/reset-user-data", response_model=dict)
async def reset_user_data(
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Wipe all entries / predictions / winner picks for every non-admin user
    and reset config (stage → 1, round → idle, no tournament winner).
    User accounts are preserved so people can log back in.
    """
    result = await crud.reset_user_data(db)
    return result


@router.post("/reset-full-system", response_model=dict)
async def reset_full_system(
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Nuclear option: delete every non-admin user (cascade-deletes all their
    entries / predictions / picks), wipe results and live, reset config.
    Admin accounts survive.
    """
    result = await crud.reset_full_system(db)
    return result
