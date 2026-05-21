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


async def create_user(db: AsyncSession, name: str, email: str, password: str, is_admin: bool = False) -> User:
    user = User(name=name, email=email, password_hash=hash_password(password), is_admin=is_admin)
    db.add(user)
    await db.commit()
    await db.refresh(user)
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
) -> GameConfig:
    cfg = await get_config(db)
    if round_state is not None:
        cfg.round_state = RoundStateEnum(round_state)
    if tournament_winner is not _UNSET:
        cfg.tournament_winner = tournament_winner if tournament_winner else None
    await db.commit()
    await db.refresh(cfg)
    return cfg


# ── Entries ───────────────────────────────────────────────────────────────────

async def get_user_entries(db: AsyncSession, user_id: int) -> list[Entry]:
    r = await db.execute(
        select(Entry).where(Entry.user_id == user_id).order_by(Entry.created_at)
    )
    return list(r.scalars().all())


async def get_entry(db: AsyncSession, entry_id: str) -> Optional[Entry]:
    return await db.get(Entry, entry_id)


def _next_entry_name(existing_names: list, user_name: str) -> str:
    if user_name not in existing_names:
        return user_name
    n = 2
    while f"{user_name} {n}" in existing_names:
        n += 1
    return f"{user_name} {n}"


async def create_entry(db: AsyncSession, user_id: int, user_name: str, name: Optional[str] = None) -> Entry:
    existing = await get_user_entries(db, user_id)
    existing_names = [e.name for e in existing]
    entry_name = name.strip() if name else _next_entry_name(existing_names, user_name)
    entry = Entry(id=str(uuid.uuid4()), user_id=user_id, name=entry_name)
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


async def rename_entry(db: AsyncSession, entry_id: str, name: str) -> Optional[Entry]:
    entry = await db.get(Entry, entry_id)
    if not entry:
        return None
    entry.name = name.strip()
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


async def submit_entry(db: AsyncSession, entry_id: str, user: User) -> Optional[Entry]:
    """Mark entry submitted and lock winner across all user entries on first submit."""
    entry = await db.get(Entry, entry_id)
    if not entry or entry.submitted_at is not None:
        return entry

    entry.submitted_at = datetime.now(timezone.utc)

    # Winner lock: on the user's first-ever submit, lock the winner
    if user.locked_winner is None:
        wp = await db.get(WinnerPick, entry_id)
        if wp:
            user.locked_winner = wp.team
            # Fan-out: stamp the locked winner onto every other entry
            other_entries = await get_user_entries(db, user.id)
            for e in other_entries:
                if e.id == entry_id:
                    continue
                other_wp = await db.get(WinnerPick, e.id)
                if other_wp:
                    other_wp.team = wp.team
                else:
                    db.add(WinnerPick(entry_id=e.id, team=wp.team))

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
    return {res.match_n: [res.score_a, res.score_b] for res in r.scalars().all()}


async def upsert_result(db: AsyncSession, match_n: int, score_a: Optional[int], score_b: Optional[int]) -> Optional[Result]:
    res = await db.get(Result, match_n)
    if score_a is None and score_b is None:
        if res:
            await db.delete(res)
            await db.commit()
        return None
    if res:
        res.score_a = score_a
        res.score_b = score_b
    else:
        res = Result(match_n=match_n, score_a=score_a, score_b=score_b)
        db.add(res)
    await db.commit()
    if res:
        await db.refresh(res)
    return res


# ── Leaderboard ───────────────────────────────────────────────────────────────

async def get_leaderboard(db: AsyncSession) -> list[LeaderboardEntry]:
    participants = await get_participants(db)
    all_preds    = await get_all_predictions(db)
    all_results  = await get_all_results(db)
    all_winners  = await get_all_winner_picks(db)
    live_map     = await get_live_matches(db)
    cfg          = await get_config(db)

    rows: list[LeaderboardEntry] = []
    for user in participants:
        user_entries = await get_user_entries(db, user.id)
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
    participants = await get_participants(db)
    all_preds    = await get_all_predictions(db)
    all_results  = await get_all_results(db)
    all_winners  = await get_all_winner_picks(db)
    live_map     = await get_live_matches(db)
    cfg          = await get_config(db)

    out = []
    for user in participants:
        user_entries = await get_user_entries(db, user.id)
        entries_data = []
        best_total = 0
        for entry in user_entries:
            preds = all_preds.get(entry.id, {})
            winner_pick = all_winners.get(entry.id)
            filled = sum(1 for v in preds.values() if v[0] is not None and v[1] is not None)
            is_submitted = entry.submitted_at is not None
            totals = user_totals(preds, all_results, winner_pick, cfg.tournament_winner, live_map) if is_submitted else None
            pts = totals["total"] if totals else None
            if pts and pts > best_total:
                best_total = pts
            entries_data.append({
                "id": entry.id,
                "name": entry.name,
                "submitted_at": entry.submitted_at.isoformat() if entry.submitted_at else None,
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


# ── Live matches ──────────────────────────────────────────────────────────────

async def get_live_matches(db: AsyncSession) -> dict:
    r = await db.execute(select(LiveMatch))
    return {m.match_n: {"score_a": m.score_a, "score_b": m.score_b, "minute": m.minute}
            for m in r.scalars().all()}


async def upsert_live_match(db: AsyncSession, match_n: int, score_a: int, score_b: int, minute: int) -> LiveMatch:
    lm = await db.get(LiveMatch, match_n)
    if lm:
        lm.score_a = score_a; lm.score_b = score_b; lm.minute = minute
    else:
        lm = LiveMatch(match_n=match_n, score_a=score_a, score_b=score_b, minute=minute)
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
    result = await upsert_result(db, match_n, lm.score_a, lm.score_b)
    await db.delete(lm)
    await db.commit()
    return result
