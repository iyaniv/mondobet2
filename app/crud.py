"""Async CRUD operations for WC2026 Predictions."""

from __future__ import annotations
from typing import Optional

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import GameConfig, LiveMatch, Prediction, Result, RoundStateEnum, User, WinnerPick
from app.auth import hash_password
from app.scoring import match_score, user_totals
from app.schemas import LeaderboardEntry


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


# ── Game Config ───────────────────────────────────────────────────────────────

async def get_config(db: AsyncSession) -> GameConfig:
    cfg = await db.get(GameConfig, 1)
    if not cfg:
        cfg = GameConfig(id=1, round_state=RoundStateEnum.idle)
        db.add(cfg)
        await db.commit()
        await db.refresh(cfg)
    return cfg


_UNSET = object()  # sentinel — distinguishes "not provided" from "explicitly None"

async def update_config(
    db: AsyncSession,
    round_state: Optional[str] = None,
    tournament_winner: object = _UNSET,
) -> GameConfig:
    cfg = await get_config(db)
    if round_state is not None:
        cfg.round_state = RoundStateEnum(round_state)
    if tournament_winner is not _UNSET:
        # None = explicitly cleared, str = new winner
        cfg.tournament_winner = tournament_winner if tournament_winner else None
    await db.commit()
    await db.refresh(cfg)
    return cfg


# ── Predictions ───────────────────────────────────────────────────────────────

async def get_user_predictions(db: AsyncSession, user_id: int) -> dict[int, list[int | None]]:
    """Returns {match_n: [score_a, score_b]}."""
    r = await db.execute(select(Prediction).where(Prediction.user_id == user_id))
    return {p.match_n: [p.score_a, p.score_b] for p in r.scalars().all()}


async def get_all_predictions(db: AsyncSession) -> dict[int, dict[int, list[int | None]]]:
    """Returns {user_id: {match_n: [score_a, score_b]}} — efficient bulk load."""
    r = await db.execute(select(Prediction))
    out: dict[int, dict[int, list]] = {}
    for p in r.scalars().all():
        out.setdefault(p.user_id, {})[p.match_n] = [p.score_a, p.score_b]
    return out


async def upsert_prediction(db: AsyncSession, user_id: int, match_n: int, score_a: Optional[int], score_b: Optional[int]) -> Prediction:
    r = await db.execute(
        select(Prediction).where(Prediction.user_id == user_id, Prediction.match_n == match_n)
    )
    pred = r.scalar_one_or_none()
    if pred:
        pred.score_a = score_a
        pred.score_b = score_b
    else:
        pred = Prediction(user_id=user_id, match_n=match_n, score_a=score_a, score_b=score_b)
        db.add(pred)
    await db.commit()
    await db.refresh(pred)
    return pred


# ── Winner picks ──────────────────────────────────────────────────────────────

async def upsert_winner_pick(db: AsyncSession, user_id: int, team: Optional[str]) -> Optional[WinnerPick]:
    r = await db.execute(select(WinnerPick).where(WinnerPick.user_id == user_id))
    wp = r.scalar_one_or_none()
    if not team:
        if wp:
            await db.delete(wp)
            await db.commit()
        return None
    if wp:
        wp.team = team
    else:
        wp = WinnerPick(user_id=user_id, team=team)
        db.add(wp)
    await db.commit()
    if wp:
        await db.refresh(wp)
    return wp


async def get_all_winner_picks(db: AsyncSession) -> dict[int, str]:
    """Returns {user_id: team}."""
    r = await db.execute(select(WinnerPick))
    return {wp.user_id: wp.team for wp in r.scalars().all()}


# ── Results ───────────────────────────────────────────────────────────────────

async def get_all_results(db: AsyncSession) -> dict[int, list[int]]:
    """Returns {match_n: [score_a, score_b]}."""
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
    all_preds = await get_all_predictions(db)
    all_results = await get_all_results(db)
    all_winners = await get_all_winner_picks(db)
    cfg = await get_config(db)

    entries: list[LeaderboardEntry] = []
    for user in participants:
        preds = all_preds.get(user.id, {})
        winner_pick = all_winners.get(user.id)
        totals = user_totals(preds, all_results, winner_pick, cfg.tournament_winner)
        submitted = sum(
            1 for v in preds.values() if v[0] is not None and v[1] is not None
        )
        entries.append(LeaderboardEntry(
            user_id=user.id,
            name=user.name,
            total=totals["total"],
            exact=totals["exact"],
            correct_dir=totals["correct_dir"],
            scored_matches=totals["scored_matches"],
            winner_pick=totals["winner_pick"],
            winner_bonus=totals["winner_bonus"],
            has_paid=user.has_paid,
            submitted_count=submitted,
        ))

    return sorted(entries, key=lambda e: e.total, reverse=True)


# ── Live matches ──────────────────────────────────────────────────────────────

async def get_live_matches(db: AsyncSession) -> dict[int, dict]:
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


async def update_user_profile(db: AsyncSession, user_id: int, name: str) -> Optional[User]:
    user = await db.get(User, user_id)
    if not user:
        return None
    if name:
        user.name = name.strip()
    await db.commit()
    await db.refresh(user)
    return user
