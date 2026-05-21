from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import get_current_user
from app.database import get_db
from app.matches import MATCHES
from app.models import RoundStateEnum, WinnerPick
from app.schemas import EntryCreate, EntryOut, EntryRename, PredictionOut

router = APIRouter(prefix="/entries", tags=["entries"])

TOTAL_MATCHES = len(MATCHES)


@router.get("/me", response_model=list[EntryOut])
async def list_my_entries(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await crud.get_user_entries(db, user.id)


@router.post("/", response_model=EntryOut, status_code=status.HTTP_201_CREATED)
async def create_entry(
    data: EntryCreate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cfg = await crud.get_config(db)
    if cfg.round_state != RoundStateEnum.open:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Betting round is not open.")
    entry = await crud.create_entry(db, user.id, user.name, data.name)
    if data.copy_from_entry_id:
        src = await crud.get_entry(db, data.copy_from_entry_id)
        if src and src.user_id == user.id:
            await crud.copy_entry_predictions(db, data.copy_from_entry_id, entry.id)
            wp = await db.get(WinnerPick, data.copy_from_entry_id)
            if wp:
                await crud.upsert_winner_pick(db, entry.id, wp.team)
    elif user.locked_winner:
        await crud.upsert_winner_pick(db, entry.id, user.locked_winner)
    return entry


@router.patch("/{entry_id}", response_model=EntryOut)
async def rename_entry(
    entry_id: str,
    data: EntryRename,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = await crud.get_entry(db, entry_id)
    if not entry or entry.user_id != user.id:
        raise HTTPException(404, "Entry not found.")
    return await crud.rename_entry(db, entry_id, data.name)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    entry_id: str,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = await crud.get_entry(db, entry_id)
    if not entry or entry.user_id != user.id:
        raise HTTPException(404, "Entry not found.")
    if entry.submitted_at is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot delete a submitted entry.")
    if not await crud.delete_entry(db, entry_id):
        raise HTTPException(500, "Delete failed.")


@router.post("/{entry_id}/submit", response_model=EntryOut)
async def submit_entry(
    entry_id: str,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = await crud.get_entry(db, entry_id)
    if not entry or entry.user_id != user.id:
        raise HTTPException(404, "Entry not found.")
    cfg = await crud.get_config(db)
    if cfg.round_state != RoundStateEnum.open:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Betting round is not open.")
    if entry.submitted_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Entry already submitted.")
    # Gate: all matches filled
    preds = await crud.get_entry_predictions(db, entry_id)
    filled = sum(1 for v in preds.values() if v[0] is not None and v[1] is not None)
    if filled < TOTAL_MATCHES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Fill all {TOTAL_MATCHES} matches first ({filled}/{TOTAL_MATCHES} done)."
        )
    # Gate: winner pick required
    wp = await db.get(WinnerPick, entry_id)
    if not wp and not user.locked_winner:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick the World Cup winner first.")
    return await crud.submit_entry(db, entry_id, user)


@router.get("/{entry_id}/predictions", response_model=list[PredictionOut])
async def entry_predictions(
    entry_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = await crud.get_entry(db, entry_id)
    if not entry:
        raise HTTPException(404, "Entry not found.")
    if entry.user_id != current_user.id and not current_user.is_admin:
        cfg = await crud.get_config(db)
        if cfg.round_state != RoundStateEnum.closed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not available until round is closed.")
    preds = await crud.get_entry_predictions(db, entry_id)
    return [PredictionOut(match_n=n, score_a=v[0], score_b=v[1]) for n, v in preds.items()]
