from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.auth import get_current_user
from app.database import get_db
from app.matches import MATCH_INDEX
from app.models import RoundStateEnum
from app.schemas import BulkPredictionsIn, PredictionIn, PredictionOut, WinnerPickIn

router = APIRouter(prefix="/predictions", tags=["predictions"])


async def _resolve_entry(entry_id: Optional[str], user, db):
    """Return the entry to operate on, or raise if not found / not owned."""
    if entry_id:
        entry = await crud.get_entry(db, entry_id)
        if not entry or entry.user_id != user.id:
            raise HTTPException(404, "Entry not found.")
        return entry
    # No entry_id: default to first draft, else last entry
    entries = await crud.get_user_entries(db, user.id)
    if not entries:
        raise HTTPException(400, "No entries found. Create an entry first.")
    draft = next((e for e in entries if e.submitted_at is None), None)
    return draft or entries[-1]


@router.get("/me", response_model=list[PredictionOut])
async def my_predictions(
    entry_id: Optional[str] = Query(None),
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = await _resolve_entry(entry_id, user, db)
    preds = await crud.get_entry_predictions(db, entry.id)
    return [PredictionOut(match_n=n, score_a=v[0], score_b=v[1]) for n, v in preds.items()]


@router.put("/me/bulk", response_model=dict)
async def set_predictions_bulk(
    data: BulkPredictionsIn,
    entry_id: Optional[str] = Query(None),
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set many predictions for one entry in a single request/transaction.

    Used by CSV import and random-fill so the client doesn't fire dozens of
    concurrent PUTs (which exhausted DB connections / contended on the entry
    row → 500s). Only current-stage matches without a result/live score are
    written; anything else is skipped.
    """
    cfg = await crud.get_config(db)
    if cfg.round_state != RoundStateEnum.open:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Betting round is not open.")
    entry = await _resolve_entry(entry_id, user, db)
    cur = cfg.current_stage or 1
    if cur > 1 and "1" not in (entry.stages_submitted or {}):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This form didn't submit stage 1 before it closed — it's no longer active."
        )
    results_map = await crud.get_all_results(db)
    live_map = await crud.get_live_matches(db)
    items, affected = [], set()
    for p in data.predictions:
        m = MATCH_INDEX.get(p.match_n)
        if not m:
            continue
        st = m.get("s") if isinstance(m, dict) else getattr(m, "s", None)
        if st != cur:                       # only the current open stage is editable
            continue
        if p.match_n in results_map or p.match_n in live_map:
            continue
        items.append((p.match_n, p.score_a, p.score_b))
        affected.add(st)
    written = await crud.bulk_upsert_predictions(db, entry.id, items)
    # Editing invalidates the affected stage's submission — user must re-Submit.
    if written:
        stages = dict(entry.stages_submitted or {})
        changed = False
        for st in affected:
            if str(st) in stages:
                del stages[str(st)]
                changed = True
        if changed:
            entry.stages_submitted = stages
            await db.commit()
    return {"written": written, "skipped": len(data.predictions) - written}


@router.put("/{match_n}", response_model=PredictionOut)
async def set_prediction(
    match_n: int,
    data: PredictionIn,
    entry_id: Optional[str] = Query(None),
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save / update a prediction.

    Users can keep editing predictions for the CURRENT open stage until that
    stage's matches have a real result or admin marks them live. Editing
    after Submit is allowed — it invalidates THIS stage's submission flag
    on the entry, so the user has to click Submit again to re-confirm.
    """
    match = MATCH_INDEX.get(match_n)
    if not match:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found.")
    cfg = await crud.get_config(db)
    if cfg.round_state != RoundStateEnum.open:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Betting round is not open.")
    # Only current-stage matches are editable. Past stages stay locked,
    # future ones aren't open yet.
    match_stage = match.get("s") if isinstance(match, dict) else getattr(match, "s", None)
    if match_stage != cfg.current_stage:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This stage is closed for predictions.")
    # Defence in depth: if admin already entered a result or live score for
    # this match, the user can't re-predict it.
    results_map = await crud.get_all_results(db)
    if match_n in results_map:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Match already has a result.")
    live_map = await crud.get_live_matches(db)
    if match_n in live_map:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Match is live — cannot edit.")
    entry = await _resolve_entry(entry_id, user, db)
    # A form that missed the stage-1 submission deadline is inactive — it can
    # neither be submitted nor edited going forward.
    if (cfg.current_stage or 1) > 1 and "1" not in (entry.stages_submitted or {}):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This form didn't submit stage 1 before it closed — it's no longer active."
        )
    pred = await crud.upsert_prediction(db, entry.id, match_n, data.score_a, data.score_b)
    # Editing invalidates this stage's submission — user must re-Submit.
    stages = dict(entry.stages_submitted or {})
    if str(match_stage) in stages:
        del stages[str(match_stage)]
        entry.stages_submitted = stages
        await db.commit()
    return PredictionOut(match_n=pred.match_n, score_a=pred.score_a, score_b=pred.score_b)


@router.put("/winner/me", response_model=dict)
async def set_winner_pick(
    data: WinnerPickIn,
    entry_id: Optional[str] = Query(None),
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set / change the tournament winner pick for the active entry.

    Editable while stage 1 is still the current open stage. Once admin
    advances `current_stage` past 1, the pick is locked.
    """
    cfg = await crud.get_config(db)
    if cfg.round_state != RoundStateEnum.open:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Betting round is not open.")
    if (cfg.current_stage or 1) > 1:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Winner pick locked — stage 1 has closed.")
    entry = await _resolve_entry(entry_id, user, db)
    await crud.upsert_winner_pick(db, entry.id, data.team)
    # The winner pick belongs to stage 1 — changing it invalidates the stage 1
    # submission (same as editing a stage-1 score), so the user must re-Submit.
    stages = dict(entry.stages_submitted or {})
    if "1" in stages:
        del stages["1"]
        entry.stages_submitted = stages
        await db.commit()
    locked = (cfg.current_stage or 1) > 1
    return {"team": data.team, "locked": locked}


@router.get("/user/{user_id}", response_model=list[PredictionOut])
async def user_predictions(
    user_id: int,
    entry_id: Optional[str] = Query(None),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return predictions:
    - Admin or own entry: all predictions, always.
    - Other user: all predictions EXCEPT the current open stage (hidden while
      users are still actively betting that stage).
    """
    viewing_own = (user_id == current_user.id)

    if entry_id:
        entry = await crud.get_entry(db, entry_id)
        if not entry:
            return []
        preds = await crud.get_entry_predictions(db, entry_id)
    else:
        entries = await crud.get_user_entries(db, user_id)
        submitted = [e for e in entries if e.submitted_at is not None]
        if not submitted:
            return []
        entry = submitted[0]
        preds = await crud.get_entry_predictions(db, entry.id)

    if not (current_user.is_admin or viewing_own or entry.submitted_at):
        return []

    all_preds = [PredictionOut(match_n=n, score_a=v[0], score_b=v[1]) for n, v in preds.items()]

    # When viewing someone else: hide predictions for the current open stage
    # while the round is still open (users are actively betting). This applies
    # to admins too — an open stage's picks stay private until it closes.
    if not viewing_own:
        cfg = await crud.get_config(db)
        if cfg.round_state == RoundStateEnum.open:
            open_stage = cfg.current_stage or 1
            open_match_ns = {m["n"] for m in MATCH_INDEX.values() if m.get("s") == open_stage}
            all_preds = [p for p in all_preds if p.match_n not in open_match_ns]

    return all_preds


@router.get("/match/{match_n}")
async def match_predictions(
    match_n: int,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, list[int]]:
    """Every submitted form's pick for one match — {entry_id: [score_a, score_b]}.

    Powers the leaderboard "Match picks" column when the user pins it to a
    specific game. Same privacy rule as /user/{id}: nobody (admins included)
    can see picks for a match in the currently-open stage while the round is
    open (everyone's still betting). Returns {} in that case; a played/closed-stage
    match is open to all. Only fully-filled picks are included.
    """
    if match_n not in MATCH_INDEX:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found.")

    cfg = await crud.get_config(db)
    if cfg.round_state == RoundStateEnum.open and MATCH_INDEX[match_n].get("s") == (cfg.current_stage or 1):
        return {}

    all_preds = await crud.get_all_predictions(db)          # {entry_id: {match_n: [a, b]}}
    all_entries = await crud.get_all_entries_by_user(db)    # {user_id: [entries]}
    submitted_ids = {e.id for ents in all_entries.values() for e in ents if e.submitted_at is not None}

    out: dict[str, list[int]] = {}
    for entry_id, preds in all_preds.items():
        if entry_id not in submitted_ids:
            continue
        v = preds.get(match_n)
        if v and v[0] is not None and v[1] is not None:
            out[entry_id] = [v[0], v[1]]
    return out
