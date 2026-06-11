from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import require_admin
from app.database import get_db
from app.footdata import sync_live_from_api
from app.matches import MATCH_INDEX
from app.schemas import LiveMatchIn, LiveMatchOut

router = APIRouter(prefix="/live", tags=["live"])


@router.get("/", response_model=list[LiveMatchOut])
async def list_live(db: AsyncSession = Depends(get_db)):
    # Best-effort: pull fresh World Cup scores from football-data.org into the
    # live_matches table before reading it back. A 10s in-process cache gates
    # the external call, and any failure is swallowed — so this never slows or
    # breaks the poll, and is a no-op entirely when no API key is configured.
    await sync_live_from_api(db)
    live = await crud.get_live_matches(db)
    return [LiveMatchOut(match_n=n, **v) for n, v in live.items()]


@router.put("/{match_n}", response_model=LiveMatchOut)
async def set_live(
    match_n: int,
    data: LiveMatchIn,
    _=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """PATCH-style — only the fields the client actually sent are written.

    So `{is_live: true}` flips the flag without touching the score; and
    `{score_a: 2, score_b: 1}` updates the score and preserves is_live.
    """
    if match_n not in MATCH_INDEX:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found.")
    # Only forward ET/pen if the client actually included them in the body —
    # otherwise leave them untouched (PATCH semantics via the crud sentinel).
    fields = data.model_dump(exclude_unset=True)
    extra = {k: fields[k] for k in ("et_a", "et_b", "pen_a", "pen_b") if k in fields}
    lm = await crud.upsert_live_match(
        db, match_n,
        score_a=data.score_a, score_b=data.score_b,
        minute=data.minute,   is_live=data.is_live,
        **extra,
    )
    return LiveMatchOut(
        match_n=lm.match_n, score_a=lm.score_a, score_b=lm.score_b,
        minute=lm.minute, is_live=bool(lm.is_live), winner=lm.winner,
        et_a=lm.et_a, et_b=lm.et_b, pen_a=lm.pen_a, pen_b=lm.pen_b,
    )


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
    return LiveMatchOut(
        match_n=match_n, score_a=result.score_a, score_b=result.score_b,
        minute=0, is_live=False, winner=result.winner,
        et_a=result.et_a, et_b=result.et_b, pen_a=result.pen_a, pen_b=result.pen_b,
    )
