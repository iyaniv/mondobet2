"""Async CRUD operations for WC2026 Predictions."""

from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Entry, GameConfig, LiveMatch, Prediction, Result, RoundStateEnum, User, WinnerPick
from app.auth import hash_password
from app.scoring import user_totals
from app.schemas import LeaderboardEntry
from app.matches import MATCHES


# ── Users ─────────────────────────────────────────────────────────────────────

async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    r = await db.execute(select(User).where(User.email == email))
    return r.scalar_one_or_none()


async def get_participants(db: AsyncSession) -> list[User]:
    r = await db.execute(select(User).where(User.is_admin.is_(False)).order_by(User.created_at))
    return list(r.scalars().all())


async def create_user(db: AsyncSession, name: str, email: str, password: str, phone: str = "", is_admin: bool = False) -> User:
    user = User(name=name, email=email, phone=phone, password_hash=hash_password(password), is_admin=is_admin)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    # Non-admins get a default first form on signup so they always have
    # something to fill in (matches the demo behaviour). Admins don't bet.
    if not is_admin:
        first = Entry(id=str(uuid.uuid4()), user_id=user.id, name=name)
        db.add(first)
        await db.commit()
    return user


async def update_user(db: AsyncSession, user_id: int, has_paid: bool) -> Optional[User]:
    user = await db.get(User, user_id)
    if not user:
        return None
    user.has_paid = has_paid
    await db.commit()
    await db.refresh(user)
    return user


async def update_user_profile(db: AsyncSession, user_id: int, name: str) -> Optional[User]:
    user = await db.get(User, user_id)
    if not user:
        return None
    if name:
        user.name = name.strip()
    await db.commit()
    await db.refresh(user)
    return user


# ── Game Config ───────────────────────────────────────────────────────────────

async def get_config(db: AsyncSession) -> GameConfig:
    cfg = await db.get(GameConfig, 1)
    if not cfg:
        cfg = GameConfig(id=1, round_state=RoundStateEnum.idle)
        db.add(cfg)
        await db.commit()
        await db.refresh(cfg)
    return cfg


_UNSET = object()


async def update_config(
    db: AsyncSession,
    round_state: Optional[str] = None,
    tournament_winner: object = _UNSET,
    data_source: Optional[str] = None,
    current_stage: Optional[int] = None,
) -> GameConfig:
    cfg = await get_config(db)
    if round_state is not None:
        cfg.round_state = RoundStateEnum(round_state)
    if tournament_winner is not _UNSET:
        cfg.tournament_winner = tournament_winner if tournament_winner else None
    if data_source is not None:
        cfg.data_source = data_source
    if current_stage is not None:
        cfg.current_stage = current_stage
    await db.commit()
    await db.refresh(cfg)
    return cfg


# ── Entries ───────────────────────────────────────────────────────────────────

async def get_user_entries(db: AsyncSession, user_id: int) -> list[Entry]:
    r = await db.execute(
        select(Entry).where(Entry.user_id == user_id).order_by(Entry.created_at)
    )
    return list(r.scalars().all())


async def get_all_entries_by_user(db: AsyncSession) -> dict:
    """Bulk fetch ALL entries and group by user_id — avoids N+1 in leaderboard.

    Returns {user_id: [Entry, ...]} ordered by created_at within each user.
    """
    r = await db.execute(select(Entry).order_by(Entry.created_at))
    out: dict = {}
    for e in r.scalars().all():
        out.setdefault(e.user_id, []).append(e)
    return out


async def get_entry(db: AsyncSession, entry_id: str) -> Optional[Entry]:
    return await db.get(Entry, entry_id)


def _next_entry_name(existing_names: list, user_name: str) -> str:
    if user_name not in existing_names:
        return user_name
    n = 2
    while f"{user_name} {n}" in existing_names:
        n += 1
    return f"{user_name} {n}"


class DuplicateEntryName(Exception):
    """Raised when an explicit entry name collides with another entry for the same user."""


async def create_entry(db: AsyncSession, user_id: int, user_name: str, name: Optional[str] = None) -> Entry:
    existing = await get_user_entries(db, user_id)
    existing_names = [e.name for e in existing]
    if name:
        entry_name = name.strip()
        if entry_name in existing_names:
            raise DuplicateEntryName(f"You already have a form named '{entry_name}'.")
    else:
        entry_name = _next_entry_name(existing_names, user_name)
    entry = Entry(id=str(uuid.uuid4()), user_id=user_id, name=entry_name)
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


async def rename_entry(db: AsyncSession, entry_id: str, name: str) -> Optional[Entry]:
    entry = await db.get(Entry, entry_id)
    if not entry:
        return None
    new_name = name.strip()
    # Reject if another entry on this user already uses that name.
    others = await get_user_entries(db, entry.user_id)
    if any(e.id != entry_id and e.name == new_name for e in others):
        raise DuplicateEntryName(f"You already have a form named '{new_name}'.")
    entry.name = new_name
    await db.commit()
    await db.refresh(entry)
    return entry


async def delete_entry(db: AsyncSession, entry_id: str) -> bool:
    entry = await db.get(Entry, entry_id)
    if not entry or entry.submitted_at is not None:
        return False
    await db.delete(entry)
    await db.commit()
    return True


async def submit_entry(db: AsyncSession, entry_id: str, user: User, stage: int = 1) -> Optional[Entry]:
    """Mark THIS stage submitted on the given entry — idempotent on re-submit.

    Per-stage submissions: each stage gets its own timestamp recorded in
    entry.stages_submitted = {"1": iso, "2": iso, ...}. submitted_at stays
    as the EARLIEST stage timestamp for back-compat.

    Re-submission is allowed: the timestamp simply updates. Users can edit
    their predictions after Submit (set_prediction clears the stage flag),
    then click Submit again to re-confirm — the same path runs.

    Winner lock used to fan out user.locked_winner on first stage-1 submit.
    That mechanism is gone now: the winner pick is editable until admin
    advances current_stage past 1, gated by set_winner_pick itself. We
    leave user.locked_winner alone (kept for back-compat).
    """
    entry = await db.get(Entry, entry_id)
    if not entry:
        return None
    now = datetime.now(timezone.utc)
    stages = dict(entry.stages_submitted or {})
    stages[str(stage)] = now.isoformat()
    entry.stages_submitted = stages
    if entry.submitted_at is None:
        entry.submitted_at = now
    await db.commit()
    await db.refresh(entry)
    return entry


# ── Predictions ───────────────────────────────────────────────────────────────

async def get_entry_predictions(db: AsyncSession, entry_id: str) -> dict:
    r = await db.execute(select(Prediction).where(Prediction.entry_id == entry_id))
    return {p.match_n: [p.score_a, p.score_b] for p in r.scalars().all()}


async def get_all_predictions(db: AsyncSession) -> dict:
    """Returns {entry_id: {match_n: [score_a, score_b]}}."""
    r = await db.execute(select(Prediction))
    out: dict = {}
    for p in r.scalars().all():
        out.setdefault(p.entry_id, {})[p.match_n] = [p.score_a, p.score_b]
    return out


async def upsert_prediction(db: AsyncSession, entry_id: str, match_n: int, score_a: Optional[int], score_b: Optional[int]) -> Prediction:
    r = await db.execute(
        select(Prediction).where(Prediction.entry_id == entry_id, Prediction.match_n == match_n)
    )
    pred = r.scalar_one_or_none()
    if pred:
        pred.score_a = score_a
        pred.score_b = score_b
    else:
        pred = Prediction(entry_id=entry_id, match_n=match_n, score_a=score_a, score_b=score_b)
        db.add(pred)
    await db.commit()
    await db.refresh(pred)
    return pred


async def copy_entry_predictions(db: AsyncSession, from_entry_id: str, to_entry_id: str) -> None:
    r = await db.execute(select(Prediction).where(Prediction.entry_id == from_entry_id))
    for src in r.scalars().all():
        db.add(Prediction(entry_id=to_entry_id, match_n=src.match_n, score_a=src.score_a, score_b=src.score_b))
    await db.commit()


# ── Winner picks ──────────────────────────────────────────────────────────────

async def upsert_winner_pick(db: AsyncSession, entry_id: str, team: Optional[str]) -> Optional[WinnerPick]:
    wp = await db.get(WinnerPick, entry_id)
    if not team:
        if wp:
            await db.delete(wp)
            await db.commit()
        return None
    if wp:
        wp.team = team
    else:
        wp = WinnerPick(entry_id=entry_id, team=team)
        db.add(wp)
    await db.commit()
    await db.refresh(wp)
    return wp


async def get_all_winner_picks(db: AsyncSession) -> dict:
    """Returns {entry_id: team}."""
    r = await db.execute(select(WinnerPick))
    return {wp.entry_id: wp.team for wp in r.scalars().all()}


# ── Results ───────────────────────────────────────────────────────────────────

async def get_all_results(db: AsyncSession) -> dict:
    r = await db.execute(select(Result))
    # Returns {match_n: [score_a, score_b, winner_or_None]}
    # winner is "a" or "b" for knockout matches decided by ET/penalties.
    return {res.match_n: [res.score_a, res.score_b, res.winner] for res in r.scalars().all()}


async def upsert_result(
    db: AsyncSession,
    match_n: int,
    score_a: Optional[int],
    score_b: Optional[int],
    winner: Optional[str] = None,
) -> Optional[Result]:
    res = await db.get(Result, match_n)
    if score_a is None and score_b is None:
        if res:
            await db.delete(res)
            await db.commit()
        return None
    if res:
        res.score_a = score_a
        res.score_b = score_b
        res.winner  = winner
    else:
        res = Result(match_n=match_n, score_a=score_a, score_b=score_b, winner=winner)
        db.add(res)
    await db.commit()
    if res:
        await db.refresh(res)
    return res


# ── Leaderboard ───────────────────────────────────────────────────────────────

async def get_leaderboard(db: AsyncSession) -> list[LeaderboardEntry]:
    participants     = await get_participants(db)
    all_entries_map  = await get_all_entries_by_user(db)  # single bulk query
    all_preds        = await get_all_predictions(db)
    all_results      = await get_all_results(db)
    all_winners      = await get_all_winner_picks(db)
    live_map         = await get_live_matches(db)
    cfg              = await get_config(db)

    rows: list[LeaderboardEntry] = []
    for user in participants:
        user_entries = all_entries_map.get(user.id, [])
        for entry in user_entries:
            if entry.submitted_at is None:
                continue  # drafts don't appear on leaderboard
            preds = all_preds.get(entry.id, {})
            winner_pick = all_winners.get(entry.id)
            totals = user_totals(preds, all_results, winner_pick, cfg.tournament_winner, live_map)
            submitted_count = sum(
                1 for v in preds.values() if v[0] is not None and v[1] is not None
            )
            rows.append(LeaderboardEntry(
                entry_id=entry.id,
                user_id=user.id,
                name=entry.name,
                total=totals["total"],
                exact=totals["exact"],
                correct_dir=totals["correct_dir"],
                scored_matches=totals["scored_matches"],
                winner_pick=totals["winner_pick"],
                winner_bonus=totals["winner_bonus"],
                has_paid=user.has_paid,
                submitted_count=submitted_count,
                live_points=totals["live_points"],
                live_matches_count=totals["live_matches_count"],
            ))

    return sorted(rows, key=lambda e: e.total, reverse=True)


# ── Admin: participants with entry details ────────────────────────────────────

async def get_participants_with_entries(db: AsyncSession) -> list[dict]:
    """Full participant data for the admin expandable table."""
    participants    = await get_participants(db)
    all_entries_map = await get_all_entries_by_user(db)  # single bulk query
    all_preds       = await get_all_predictions(db)
    all_results     = await get_all_results(db)
    all_winners     = await get_all_winner_picks(db)
    live_map        = await get_live_matches(db)
    cfg             = await get_config(db)

    out = []
    for user in participants:
        user_entries = all_entries_map.get(user.id, [])
        entries_data = []
        best_total = 0
        match_stage_lookup = {m["n"]: m["s"] for m in MATCHES}
        stage_totals = {}
        for m in MATCHES:
            stage_totals[m["s"]] = stage_totals.get(m["s"], 0) + 1
        for entry in user_entries:
            preds = all_preds.get(entry.id, {})
            winner_pick = all_winners.get(entry.id)
            filled = sum(1 for v in preds.values() if v[0] is not None and v[1] is not None)
            # Per-stage filled counts
            stage_filled = {s: 0 for s in stage_totals}
            for n, v in preds.items():
                if v[0] is None or v[1] is None:
                    continue
                s = match_stage_lookup.get(n)
                if s is not None:
                    stage_filled[s] += 1
            is_submitted = entry.submitted_at is not None
            totals = user_totals(preds, all_results, winner_pick, cfg.tournament_winner, live_map) if is_submitted else None
            pts = totals["total"] if totals else None
            if pts and pts > best_total:
                best_total = pts
            entries_data.append({
                "id": entry.id,
                "name": entry.name,
                "submitted_at": entry.submitted_at.isoformat() if entry.submitted_at else None,
                "stages_submitted": entry.stages_submitted or {},
                "stage_filled": stage_filled,
                "stage_totals": stage_totals,
                "filled": filled,
                "total_matches": len(MATCHES),
                "winner_pick": winner_pick,
                "locked_winner": user.locked_winner,
                "points": pts,
                "live_points": totals["live_points"] if totals else 0,
            })
        submitted_count = sum(1 for e in user_entries if e.submitted_at is not None)
        draft_count = len(user_entries) - submitted_count
        out.append({
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "has_paid": user.has_paid,
            "locked_winner": user.locked_winner,
            "entries": entries_data,
            "submitted_count": submitted_count,
            "draft_count": draft_count,
            "best_total": best_total,
        })
    return out


async def delete_all_results_and_live(db: AsyncSession) -> dict:
    """Wipe every Result and every LiveMatch row. Returns counts deleted.

    Used by the admin "reset all results" testing helper. Predictions,
    entries, users, winner picks, config and stages are untouched.
    """
    from sqlalchemy import delete as sql_delete
    r1 = await db.execute(sql_delete(Result))
    r2 = await db.execute(sql_delete(LiveMatch))
    await db.commit()
    return {"results": r1.rowcount or 0, "live": r2.rowcount or 0}


async def reset_user_data(
    db: AsyncSession,
    user_id: Optional[int] = None,
    entry_id: Optional[str] = None,
) -> dict:
    """Wipe entries / predictions / winner picks, keeping user accounts.

    Scope:
    - entry_id only  → delete that single entry (cascade removes its predictions/pick)
    - user_id only   → delete all entries for that user + clear locked_winner
    - neither        → delete all entries for every non-admin user, reset config
    """
    from sqlalchemy import delete as sql_delete, update as sql_update

    if entry_id:
        r1 = await db.execute(sql_delete(Entry).where(Entry.id == entry_id))
        await db.commit()
        return {"entries_deleted": r1.rowcount or 0}

    if user_id:
        r1 = await db.execute(sql_delete(Entry).where(Entry.user_id == user_id))
        await db.execute(
            sql_update(User).where(User.id == user_id).values(locked_winner=None)
        )
        await db.commit()
        return {"entries_deleted": r1.rowcount or 0}

    # Full scope — all non-admin users
    r1 = await db.execute(
        sql_delete(Entry).where(
            Entry.user_id.in_(select(User.id).where(User.is_admin.is_(False)))
        )
    )
    await db.execute(
        sql_update(User).where(User.is_admin.is_(False)).values(locked_winner=None)
    )
    cfg = await get_config(db)
    cfg.round_state = RoundStateEnum.idle
    cfg.current_stage = 1
    cfg.tournament_winner = None
    await db.commit()
    return {"entries_deleted": r1.rowcount or 0}


async def reset_full_system(
    db: AsyncSession,
    user_id: Optional[int] = None,
) -> dict:
    """Delete non-admin user(s) and all their data via CASCADE.

    Scope:
    - user_id → delete only that user (no config/results touch)
    - neither → delete every non-admin user + results + live + reset config
    """
    from sqlalchemy import delete as sql_delete

    if user_id:
        r1 = await db.execute(
            sql_delete(User).where(User.id == user_id, User.is_admin.is_(False))
        )
        await db.commit()
        return {"users_deleted": r1.rowcount or 0}

    # Nuclear — everything
    r1 = await db.execute(sql_delete(User).where(User.is_admin.is_(False)))
    r2 = await db.execute(sql_delete(Result))
    r3 = await db.execute(sql_delete(LiveMatch))
    cfg = await get_config(db)
    cfg.round_state = RoundStateEnum.idle
    cfg.current_stage = 1
    cfg.tournament_winner = None
    await db.commit()
    return {
        "users_deleted": r1.rowcount or 0,
        "results_deleted": r2.rowcount or 0,
        "live_deleted": r3.rowcount or 0,
    }


# ── Live matches ──────────────────────────────────────────────────────────────

async def get_live_matches(db: AsyncSession) -> dict:
    r = await db.execute(select(LiveMatch))
    return {m.match_n: {"score_a": m.score_a, "score_b": m.score_b, "minute": m.minute,
                        "is_live": bool(m.is_live), "winner": m.winner}
            for m in r.scalars().all()}


async def upsert_live_match(
    db: AsyncSession,
    match_n: int,
    score_a: Optional[int] = None,
    score_b: Optional[int] = None,
    minute: Optional[int] = None,
    is_live: Optional[bool] = None,
    winner: Optional[str] = None,
) -> LiveMatch:
    """PATCH-style upsert — only the fields actually passed are written.

    Critical: if the caller only wants to flip `is_live`, the score is NOT
    reset to 0. That was the silent bug where clicking ▶ LIVE was sending
    a body without scores and the backend wiped them.
    """
    lm = await db.get(LiveMatch, match_n)
    if lm:
        if score_a is not None: lm.score_a = score_a
        if score_b is not None: lm.score_b = score_b
        if minute  is not None: lm.minute  = minute
        if is_live is not None: lm.is_live = is_live
        if winner  is not None: lm.winner  = winner
    else:
        lm = LiveMatch(
            match_n=match_n,
            score_a=score_a if score_a is not None else 0,
            score_b=score_b if score_b is not None else 0,
            minute=minute   if minute  is not None else 0,
            is_live=is_live if is_live is not None else False,
            winner=winner,
        )
        db.add(lm)
    await db.commit()
    await db.refresh(lm)
    return lm


async def remove_live_match(db: AsyncSession, match_n: int) -> bool:
    lm = await db.get(LiveMatch, match_n)
    if not lm:
        return False
    await db.delete(lm)
    await db.commit()
    return True


async def finalize_live_match(db: AsyncSession, match_n: int) -> Optional[Result]:
    lm = await db.get(LiveMatch, match_n)
    if not lm:
        return None
    result = await upsert_result(db, match_n, lm.score_a, lm.score_b, winner=lm.winner)
    await db.delete(lm)
    await db.commit()
    return result
