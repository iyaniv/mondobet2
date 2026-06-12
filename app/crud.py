"""Async CRUD operations for WC2026 Predictions."""

from __future__ import annotations
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Entry, GameConfig, LiveMatch, Prediction, Result, RoundStateEnum, User, WinnerPick
from app.auth import hash_password
from app.scoring import user_totals
from app.schemas import LeaderboardEntry
from app.matches import MATCHES, MATCH_INDEX


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


async def set_user_help_seen(db: AsyncSession, user_id: int, help_seen: dict) -> Optional[User]:
    """Replace the user's help_seen map (full replacement, not patch)."""
    user = await db.get(User, user_id)
    if not user:
        return None
    # Normalize: only keep bool true keys, drop anything else.
    cleaned = {k: True for k, v in (help_seen or {}).items() if v and isinstance(k, str)}
    user.help_seen = cleaned
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
        # When the stage ADVANCES, snapshot the current standings (the end of
        # the stage just finished) so the leaderboard can show per-stage rank
        # movement vs this baseline until the next advance.
        if current_stage > (cfg.current_stage or 1):
            lb = await get_leaderboard(db)
            ranks = {row.entry_id: i + 1 for i, row in enumerate(lb)}
            cfg.stage_baseline = {"stage": current_stage, "ranks": ranks}
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
    # Snapshot the just-submitted state, for "Reset draft" (overwrites each
    # submit → always the latest submission).
    preds_rows = (await db.execute(
        select(Prediction).where(Prediction.entry_id == entry_id)
    )).scalars().all()
    wp_row = await db.get(WinnerPick, entry_id)
    entry.submitted_snapshot = {
        "at": now.isoformat(),
        "winner": wp_row.team if wp_row else None,
        "preds": {str(p.match_n): [p.score_a, p.score_b]
                  for p in preds_rows
                  if p.score_a is not None and p.score_b is not None},
    }
    await db.commit()
    await db.refresh(entry)
    return entry


async def reset_draft(db: AsyncSession, entry_id: str, stage: int = 1) -> Optional[Entry]:
    """Discard un-submitted edits: restore the entry's predictions + winner from
    `submitted_snapshot` and re-mark the given stage submitted (back to the
    locked, submitted state). Returns None if there's no snapshot to restore.
    """
    from sqlalchemy import delete as sql_delete
    entry = await db.get(Entry, entry_id)
    if not entry or not entry.submitted_snapshot:
        return None
    snap = entry.submitted_snapshot
    preds = snap.get("preds") or {}
    # Replace predictions with exactly the snapshot's set.
    await db.execute(sql_delete(Prediction).where(Prediction.entry_id == entry_id))
    for mn, sc in preds.items():
        if sc and sc[0] is not None and sc[1] is not None:
            db.add(Prediction(entry_id=entry_id, match_n=int(mn),
                              score_a=sc[0], score_b=sc[1]))
    # Restore the winner pick.
    target = snap.get("winner")
    wp = await db.get(WinnerPick, entry_id)
    if target:
        if wp:
            wp.team = target
        else:
            db.add(WinnerPick(entry_id=entry_id, team=target))
    elif wp:
        await db.delete(wp)
    # Back to submitted: re-mark this stage with the snapshot's timestamp.
    stages = dict(entry.stages_submitted or {})
    stages[str(stage)] = snap.get("at") or datetime.now(timezone.utc).isoformat()
    entry.stages_submitted = stages
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


async def bulk_upsert_predictions(db: AsyncSession, entry_id: str, items: list) -> int:
    """Upsert many predictions for one entry in a SINGLE transaction.

    `items` is a list of (match_n, score_a, score_b). Existing rows are
    updated, missing ones inserted. One commit at the end — avoids the
    N-concurrent-writes storm that the per-match endpoint caused on import.
    Returns the number of rows written.
    """
    if not items:
        return 0
    match_ns = [it[0] for it in items]
    r = await db.execute(
        select(Prediction).where(Prediction.entry_id == entry_id, Prediction.match_n.in_(match_ns))
    )
    existing = {p.match_n: p for p in r.scalars().all()}
    for match_n, score_a, score_b in items:
        pred = existing.get(match_n)
        if pred:
            pred.score_a, pred.score_b = score_a, score_b
        else:
            db.add(Prediction(entry_id=entry_id, match_n=match_n, score_a=score_a, score_b=score_b))
    await db.commit()
    return len(items)


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

def derive_winner(
    score_a: Optional[int], score_b: Optional[int],
    et_a: Optional[int] = None, et_b: Optional[int] = None,
    pen_a: Optional[int] = None, pen_b: Optional[int] = None,
) -> Optional[str]:
    """Determine who advanced: penalties → extra time → 90-min score.

    Returns "a", "b", or None (genuinely tied / undecided).
    """
    if pen_a is not None and pen_b is not None and pen_a != pen_b:
        return "a" if pen_a > pen_b else "b"
    if et_a is not None and et_b is not None and et_a != et_b:
        return "a" if et_a > et_b else "b"
    if score_a is not None and score_b is not None and score_a != score_b:
        return "a" if score_a > score_b else "b"
    return None


_SLOT_RE = re.compile(r"^([WL]) M(\d+)$")


def resolve_team(name: str, results: dict, depth: int = 0):
    """Resolve a bracket slot ('W M101' / 'L M101') to the actual team using
    final results. Recurses through the bracket; bottoms out at group-stage
    matches (real team names). Returns the slot unchanged if undecided."""
    if depth > 12 or not isinstance(name, str):
        return name
    m = _SLOT_RE.match(name)
    if not m:
        return name  # already a real team
    typ, n = m.group(1), int(m.group(2))
    src = MATCH_INDEX.get(n)
    res = results.get(n)
    if not src or not res:
        return name  # not played yet
    sa, sb, winner = res[0], res[1], res[2]
    w = winner or ("a" if sa > sb else "b" if sb > sa else None)
    if not w:
        return name  # knockout tie not yet decided
    side = w if typ == "W" else ("b" if w == "a" else "a")
    return resolve_team(src["a"] if side == "a" else src["b"], results, depth + 1)


async def _maybe_crown_champion(db: AsyncSession, match_n: int, result):
    """When the FINAL (g='FIN') gets a decided winner, auto-set
    config.tournament_winner to the winning team. The +10 winner bonus then
    follows automatically from scoring — no separate points handling needed."""
    if result is None or not getattr(result, "winner", None):
        return
    src = MATCH_INDEX.get(match_n)
    if not src or src.get("g") != "FIN":
        return
    all_results = await get_all_results(db)
    champ_slot = src["a"] if result.winner == "a" else src["b"]
    champion = resolve_team(champ_slot, all_results)
    if not champion or _SLOT_RE.match(str(champion)):
        return  # couldn't resolve to a real team yet
    cfg = await get_config(db)
    if cfg.tournament_winner != champion:
        cfg.tournament_winner = champion
        await db.commit()


async def get_all_results(db: AsyncSession) -> dict:
    r = await db.execute(select(Result))
    # Returns {match_n: [score_a, score_b, winner, et_a, et_b, pen_a, pen_b]}
    # score_a/score_b are the 90-min score (points). winner is auto-derived.
    return {
        res.match_n: [res.score_a, res.score_b, res.winner,
                      res.et_a, res.et_b, res.pen_a, res.pen_b]
        for res in r.scalars().all()
    }


async def upsert_result(
    db: AsyncSession,
    match_n: int,
    score_a: Optional[int],
    score_b: Optional[int],
    et_a: Optional[int] = None,
    et_b: Optional[int] = None,
    pen_a: Optional[int] = None,
    pen_b: Optional[int] = None,
) -> Optional[Result]:
    res = await db.get(Result, match_n)
    if score_a is None and score_b is None:
        if res:
            await db.delete(res)
            await db.commit()
        return None
    winner = derive_winner(score_a, score_b, et_a, et_b, pen_a, pen_b)
    if res:
        res.score_a, res.score_b = score_a, score_b
        res.et_a, res.et_b = et_a, et_b
        res.pen_a, res.pen_b = pen_a, pen_b
        res.winner = winner
    else:
        res = Result(match_n=match_n, score_a=score_a, score_b=score_b,
                     et_a=et_a, et_b=et_b, pen_a=pen_a, pen_b=pen_b, winner=winner)
        db.add(res)
    await db.commit()
    if res:
        await db.refresh(res)
    # If this was the FINAL and a winner is decided, crown the champion.
    await _maybe_crown_champion(db, match_n, res)
    return res


# ── Leaderboard ───────────────────────────────────────────────────────────────

async def get_leaderboard(
    db: AsyncSession,
    sim_results: Optional[dict] = None,
    sim_winner: Optional[str] = None,
    sim_user_id: Optional[int] = None,
) -> list[LeaderboardEntry]:
    """Compute the leaderboard.

    Simulation mode (sim_results / sim_winner): treat the given match scores as
    if they were real results for matches that DON'T already have a final
    result or a live score, and (if no tournament winner is set yet) assume
    sim_winner is the eventual champion.

    Privacy: while the betting round is OPEN, other users' predictions for the
    still-open matches are hidden, so the simulated results are applied ONLY to
    the requesting user's own forms (sim_user_id). Everyone else stays at their
    real, currently-visible totals — otherwise simulating would leak rivals'
    standings on a stage that hasn't closed yet. Once the round is closed
    (forms revealed), the simulation applies to everyone.
    """
    participants     = await get_participants(db)
    all_entries_map  = await get_all_entries_by_user(db)  # single bulk query
    all_preds        = await get_all_predictions(db)
    all_results      = await get_all_results(db)
    all_winners      = await get_all_winner_picks(db)
    live_map         = await get_live_matches(db)
    cfg              = await get_config(db)

    round_open = cfg.round_state == RoundStateEnum.open

    # Build the simulated results (real results win; sim fills unplayed matches).
    sim_results_map = dict(all_results)
    sim_tournament_winner = cfg.tournament_winner
    if sim_results:
        for n, v in sim_results.items():
            mn = int(n)
            if mn in all_results or mn in live_map:
                continue
            if v and len(v) >= 2 and v[0] is not None and v[1] is not None:
                sim_results_map[mn] = [int(v[0]), int(v[1])]
        if sim_winner and not cfg.tournament_winner:
            sim_tournament_winner = sim_winner

    rows: list[LeaderboardEntry] = []
    for user in participants:
        user_entries = all_entries_map.get(user.id, [])
        # Apply the simulation to this entry's owner only if: not a sim at all
        # (normal board) → no; OR the round is closed (everyone revealed); OR
        # this is the simulating user's own form.
        apply_sim = bool(sim_results) and (not round_open or user.id == sim_user_id)
        results_for_scoring = sim_results_map if apply_sim else all_results
        tournament_winner   = sim_tournament_winner if apply_sim else cfg.tournament_winner
        for entry in user_entries:
            if entry.submitted_at is None:
                continue  # drafts don't appear on leaderboard
            preds = all_preds.get(entry.id, {})
            winner_pick = all_winners.get(entry.id)
            totals = user_totals(preds, results_for_scoring, winner_pick, tournament_winner, live_map)
            submitted_count = sum(
                1 for v in preds.values() if v[0] is not None and v[1] is not None
            )
            # This form's picks for the in-play matches (opt-in "Live picks"
            # columns). Only fully-filled picks for is_live matches are included.
            live_preds = {
                n: [v[0], v[1]]
                for n, lm in live_map.items()
                if lm.get("is_live")
                and (v := preds.get(n)) is not None
                and v[0] is not None and v[1] is not None
            }
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
                live_preds=live_preds,
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
            "phone": user.phone,
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


# ── Backup / Restore ────────────────────────────────────────────────────────

BACKUP_VERSION = 1


def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt is not None else None


def _parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


async def export_all(db: AsyncSession) -> dict:
    """Serialize every app table to a single JSON-able dict (full snapshot).

    Shape: {version, created_at, counts, data:{users, entries, predictions,
    winner_picks, results, live_matches, game_config}}. Used by the admin
    "Download backup" feature; import_all() consumes the same shape.
    """
    users = (await db.execute(select(User))).scalars().all()
    entries = (await db.execute(select(Entry))).scalars().all()
    preds = (await db.execute(select(Prediction))).scalars().all()
    wps = (await db.execute(select(WinnerPick))).scalars().all()
    results = (await db.execute(select(Result))).scalars().all()
    lives = (await db.execute(select(LiveMatch))).scalars().all()
    cfg = await get_config(db)

    rs = cfg.round_state
    data = {
        "users": [
            {
                "id": u.id, "name": u.name, "email": u.email,
                "password_hash": u.password_hash, "is_admin": bool(u.is_admin),
                "has_paid": bool(u.has_paid), "phone": u.phone or "",
                "locked_winner": u.locked_winner, "help_seen": u.help_seen or {},
                "created_at": _iso(u.created_at),
            }
            for u in users
        ],
        "entries": [
            {
                "id": e.id, "user_id": e.user_id, "name": e.name,
                "created_at": _iso(e.created_at), "submitted_at": _iso(e.submitted_at),
                "stages_submitted": e.stages_submitted or {},
                "submitted_snapshot": e.submitted_snapshot,
            }
            for e in entries
        ],
        "predictions": [
            {"entry_id": p.entry_id, "match_n": p.match_n,
             "score_a": p.score_a, "score_b": p.score_b}
            for p in preds
        ],
        "winner_picks": [{"entry_id": w.entry_id, "team": w.team} for w in wps],
        "results": [
            {"match_n": r.match_n, "score_a": r.score_a, "score_b": r.score_b,
             "et_a": r.et_a, "et_b": r.et_b, "pen_a": r.pen_a, "pen_b": r.pen_b,
             "winner": r.winner}
            for r in results
        ],
        "live_matches": [
            {"match_n": m.match_n, "score_a": m.score_a, "score_b": m.score_b,
             "minute": m.minute, "is_live": bool(m.is_live),
             "et_a": m.et_a, "et_b": m.et_b, "pen_a": m.pen_a, "pen_b": m.pen_b,
             "winner": m.winner, "updated_at": _iso(m.updated_at)}
            for m in lives
        ],
        "game_config": {
            "round_state": rs.value if hasattr(rs, "value") else rs,
            "tournament_winner": cfg.tournament_winner,
            "data_source": cfg.data_source,
            "current_stage": cfg.current_stage,
            "stage_baseline": cfg.stage_baseline,
        },
    }
    counts = {k: (len(v) if isinstance(v, list) else 1) for k, v in data.items()}
    return {
        "version": BACKUP_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "counts": counts,
        "data": data,
    }


async def import_all(db: AsyncSession, payload: dict) -> dict:
    """Destructively replace ALL app data from a backup produced by export_all().

    Atomic: wipes every table then re-inserts inside one transaction; rolls back
    on any error. User ids are preserved (entries reference them) and the users
    id-sequence is re-synced so future signups don't collide. After restore the
    configured admin is guaranteed to exist & be able to log in, so a backup
    that omits the current admin can never lock you out.
    """
    import os
    from sqlalchemy import delete as sql_delete, text
    from app.config import settings
    from app.auth import verify_password

    if not isinstance(payload, dict):
        raise ValueError("Invalid backup: not an object")
    if payload.get("version") != BACKUP_VERSION:
        raise ValueError(f"Unsupported backup version (expected {BACKUP_VERSION})")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("Invalid backup: missing 'data'")

    try:
        # Wipe in FK-safe order.
        await db.execute(sql_delete(Prediction))
        await db.execute(sql_delete(WinnerPick))
        await db.execute(sql_delete(Entry))
        await db.execute(sql_delete(User))
        await db.execute(sql_delete(Result))
        await db.execute(sql_delete(LiveMatch))

        for u in data.get("users", []):
            db.add(User(
                id=u["id"], name=u["name"], email=u["email"],
                password_hash=u["password_hash"], is_admin=bool(u.get("is_admin")),
                has_paid=bool(u.get("has_paid")), phone=u.get("phone", "") or "",
                locked_winner=u.get("locked_winner"), help_seen=u.get("help_seen") or {},
                created_at=_parse_dt(u.get("created_at")),
            ))
        await db.flush()

        for e in data.get("entries", []):
            db.add(Entry(
                id=e["id"], user_id=e["user_id"], name=e["name"],
                created_at=_parse_dt(e.get("created_at")),
                submitted_at=_parse_dt(e.get("submitted_at")),
                stages_submitted=e.get("stages_submitted") or {},
                submitted_snapshot=e.get("submitted_snapshot"),
            ))
        await db.flush()

        # Predictions: let the SERIAL id auto-assign (nothing references it).
        for p in data.get("predictions", []):
            db.add(Prediction(
                entry_id=p["entry_id"], match_n=p["match_n"],
                score_a=p.get("score_a"), score_b=p.get("score_b"),
            ))
        for w in data.get("winner_picks", []):
            db.add(WinnerPick(entry_id=w["entry_id"], team=w["team"]))
        for r in data.get("results", []):
            db.add(Result(
                match_n=r["match_n"], score_a=r["score_a"], score_b=r["score_b"],
                et_a=r.get("et_a"), et_b=r.get("et_b"),
                pen_a=r.get("pen_a"), pen_b=r.get("pen_b"), winner=r.get("winner"),
            ))
        for m in data.get("live_matches", []):
            db.add(LiveMatch(
                match_n=m["match_n"], score_a=m.get("score_a", 0),
                score_b=m.get("score_b", 0), minute=m.get("minute", 0),
                is_live=bool(m.get("is_live")), et_a=m.get("et_a"), et_b=m.get("et_b"),
                pen_a=m.get("pen_a"), pen_b=m.get("pen_b"), winner=m.get("winner"),
                updated_at=_parse_dt(m.get("updated_at")),
            ))

        # Overwrite the singleton game_config in place.
        cfg = await get_config(db)
        gc = data.get("game_config") or {}
        rs = gc.get("round_state", "idle")
        cfg.round_state = rs if isinstance(rs, RoundStateEnum) else RoundStateEnum(rs)
        cfg.tournament_winner = gc.get("tournament_winner")
        cfg.data_source = gc.get("data_source", "manual") or "manual"
        cfg.current_stage = gc.get("current_stage", 1) or 1
        cfg.stage_baseline = gc.get("stage_baseline")

        await db.flush()

        # Re-sync the users id sequence so future signups don't collide with
        # restored ids.
        await db.execute(text(
            "SELECT setval(pg_get_serial_sequence('users','id'), "
            "GREATEST((SELECT COALESCE(MAX(id), 1) FROM users), 1))"
        ))

        # Guarantee the configured admin can still log in.
        admin = await get_user_by_email(db, settings.admin_email.lower())
        if not admin:
            await create_user(
                db, name="Admin", email=settings.admin_email.lower(),
                password=settings.admin_password, is_admin=True,
            )
        else:
            env_pw = os.environ.get("ADMIN_PASSWORD")
            if env_pw and not verify_password(env_pw, admin.password_hash):
                admin.password_hash = hash_password(env_pw)

        await db.commit()
    except Exception:
        await db.rollback()
        raise

    return {k: (len(v) if isinstance(v, list) else 1) for k, v in data.items()}


# ── Live matches ──────────────────────────────────────────────────────────────

async def get_live_matches(db: AsyncSession) -> dict:
    r = await db.execute(select(LiveMatch))
    return {m.match_n: {"score_a": m.score_a, "score_b": m.score_b, "minute": m.minute,
                        "is_live": bool(m.is_live), "winner": m.winner,
                        "et_a": m.et_a, "et_b": m.et_b, "pen_a": m.pen_a, "pen_b": m.pen_b}
            for m in r.scalars().all()}


_UNSET_INT = object()


async def upsert_live_match(
    db: AsyncSession,
    match_n: int,
    score_a: Optional[int] = None,
    score_b: Optional[int] = None,
    minute: Optional[int] = None,
    is_live: Optional[bool] = None,
    et_a: object = _UNSET_INT,
    et_b: object = _UNSET_INT,
    pen_a: object = _UNSET_INT,
    pen_b: object = _UNSET_INT,
) -> LiveMatch:
    """PATCH-style upsert — only the fields actually passed are written.

    Critical: if the caller only wants to flip `is_live`, the score is NOT
    reset to 0. That was the silent bug where clicking ▶ LIVE was sending
    a body without scores and the backend wiped them.

    ET/pen use a sentinel so an explicit None (clearing) is distinguishable
    from "not provided". winner is re-derived from the merged state.
    """
    lm = await db.get(LiveMatch, match_n)
    if lm:
        if score_a is not None: lm.score_a = score_a
        if score_b is not None: lm.score_b = score_b
        if minute  is not None: lm.minute  = minute
        if is_live is not None: lm.is_live = is_live
        if et_a  is not _UNSET_INT: lm.et_a  = et_a
        if et_b  is not _UNSET_INT: lm.et_b  = et_b
        if pen_a is not _UNSET_INT: lm.pen_a = pen_a
        if pen_b is not _UNSET_INT: lm.pen_b = pen_b
    else:
        lm = LiveMatch(
            match_n=match_n,
            score_a=score_a if score_a is not None else 0,
            score_b=score_b if score_b is not None else 0,
            minute=minute   if minute  is not None else 0,
            is_live=is_live if is_live is not None else False,
            et_a=None  if et_a  is _UNSET_INT else et_a,
            et_b=None  if et_b  is _UNSET_INT else et_b,
            pen_a=None if pen_a is _UNSET_INT else pen_a,
            pen_b=None if pen_b is _UNSET_INT else pen_b,
        )
        db.add(lm)
    lm.winner = derive_winner(lm.score_a, lm.score_b, lm.et_a, lm.et_b, lm.pen_a, lm.pen_b)
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
    result = await upsert_result(
        db, match_n, lm.score_a, lm.score_b,
        et_a=lm.et_a, et_b=lm.et_b, pen_a=lm.pen_a, pen_b=lm.pen_b,
    )
    await db.delete(lm)
    await db.commit()
    return result
