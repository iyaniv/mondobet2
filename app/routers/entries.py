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

# (per-stage submission gates the submit endpoint — no full TOTAL_MATCHES check anymore)


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
    try:
        entry = await crud.create_entry(db, user.id, user.name, data.name)
    except crud.DuplicateEntryName as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
    if data.copy_from_entry_id:
        src = await crud.get_entry(db, data.copy_from_entry_id)
        if src and src.user_id == user.id:
            await crud.copy_entry_predictions(db, data.copy_from_entry_id, entry.id)
            wp = await db.get(WinnerPick, data.copy_from_entry_id)
            if wp:
                await crud.upsert_winner_pick(db, entry.id, wp.team)
    # NEW empty forms start blank — no auto-inherit of user.locked_winner.
    # The user picks their winner explicitly on the new form. (Old behaviour
    # was to fan out locked_winner to every new form, but per the new
    # "winner editable until stage 1 closes" rule, that's no longer right.)
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
    try:
        return await crud.rename_entry(db, entry_id, data.name)
    except crud.DuplicateEntryName as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    entry_id: str,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = await crud.get_entry(db, entry_id)
    if not entry or (entry.user_id != user.id and not user.is_admin):
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
    # Per-stage submission: gate only the matches the user CAN actually
    # predict for the current open stage. Past stages stay locked. Re-
    # submitting the same stage is allowed — users may edit their picks
    # after Submit, which invalidates the stage flag in set_prediction
    # and forces them to come back here to re-confirm.
    stage = cfg.current_stage or 1
    results_map = await crud.get_all_results(db)
    live_map = await crud.get_live_matches(db)
    stage_matches = [
        m for m in MATCHES
        if m.get("s") == stage
        and m["n"] not in results_map
        and m["n"] not in live_map
    ]
    preds = await crud.get_entry_predictions(db, entry_id)
    filled = sum(
        1 for m in stage_matches
        if preds.get(m["n"]) and preds[m["n"]][0] is not None and preds[m["n"]][1] is not None
    )
    if filled < len(stage_matches):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Fill all {len(stage_matches)} stage {stage} predictions first ({filled}/{len(stage_matches)} done)."
        )
    # Winner pick required only on the FIRST stage submission.
    if stage == 1:
        wp = await db.get(WinnerPick, entry_id)
        if not wp:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick the World Cup winner first.")
    return await crud.submit_entry(db, entry_id, user, stage=stage)


@router.get("/{entry_id}/predictions", response_model=list[PredictionOut])
async def entry_predictions(
    entry_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = await crud.get_entry(db, entry_id)
    if not entry:
        raise HTTPException(404, "Entry not found.")
    preds = await crud.get_entry_predictions(db, entry_id)
    viewing_own = (entry.user_id == current_user.id)
    # Admin or own: see all. Others: see all if the entry is submitted.
    if current_user.is_admin or viewing_own or entry.submitted_at:
        return [PredictionOut(match_n=n, score_a=v[0], score_b=v[1]) for n, v in preds.items()]
    return []
