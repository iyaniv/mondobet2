"""SQLAlchemy ORM models for WC2026 Predictions."""

from __future__ import annotations
import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean, Date, DateTime, Enum, ForeignKey, Integer,
    SmallInteger, String, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class RoundStateEnum(str, enum.Enum):
    idle = "idle"
    open = "open"
    closed = "closed"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(200), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(200), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_paid: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    phone: Mapped[str] = mapped_column(String(50), nullable=False, server_default="")
    locked_winner: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    # Per-user, per-tab onboarding flags. Keys: welcome, predictions, tournament,
    # leaderboard, byuser, settings, results, dashboard.
    help_seen: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}", default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    entries: Mapped[list["Entry"]] = relationship(
        "Entry", back_populates="user", cascade="all, delete-orphan",
        order_by="Entry.created_at",
    )


class Entry(Base):
    __tablename__ = "entries"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    submitted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Per-stage submission timestamps: {"1": "2026-06-01T...", "2": null, ...}
    # Source of truth — submitted_at stays as the earliest stage timestamp
    # for back-compat with code that hasn't been migrated yet.
    stages_submitted: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    # Snapshot of the last SUBMITTED state, for the "Reset draft" feature:
    # {"at": iso, "winner": "France"|None, "preds": {"1": [2, 1], ...}}.
    submitted_snapshot: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    @property
    def submitted_snapshot_at(self) -> Optional[str]:
        """ISO timestamp of the last submission snapshot (or None) — exposed to
        the client so it can show/hide the Reset-draft control."""
        return (self.submitted_snapshot or {}).get("at")

    user: Mapped["User"] = relationship("User", back_populates="entries")
    predictions: Mapped[list["Prediction"]] = relationship(
        "Prediction", back_populates="entry", cascade="all, delete-orphan"
    )
    winner_pick: Mapped[Optional["WinnerPick"]] = relationship(
        "WinnerPick", back_populates="entry", cascade="all, delete-orphan", uselist=False
    )


class Prediction(Base):
    __tablename__ = "predictions"
    __table_args__ = (UniqueConstraint("entry_id", "match_n", name="uq_entry_match"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("entries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    match_n: Mapped[int] = mapped_column(Integer, nullable=False)
    score_a: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    score_b: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)

    entry: Mapped["Entry"] = relationship("Entry", back_populates="predictions")


class Result(Base):
    __tablename__ = "results"

    match_n: Mapped[int] = mapped_column(Integer, primary_key=True)
    # 90-minute (regular time) score — this is what scoring/points use.
    score_a: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    score_b: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    # Knockout stages only — cumulative score after extra time (a.e.t.).
    # NULL unless the match went to extra time.
    et_a: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    et_b: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    # Knockout stages only — penalty shootout score. NULL unless it went to pens.
    pen_a: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    pen_b: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    # "a" or "b" — who advanced. Auto-derived from pens → ET → 90-min score.
    # NULL for group-stage matches or knockout matches still tied/undecided.
    winner: Mapped[Optional[str]] = mapped_column(String(1), nullable=True)


class WinnerPick(Base):
    __tablename__ = "winner_picks"

    entry_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("entries.id", ondelete="CASCADE"), primary_key=True
    )
    team: Mapped[str] = mapped_column(String(100), nullable=False)

    entry: Mapped["Entry"] = relationship("Entry", back_populates="winner_pick")


class GameConfig(Base):
    """Singleton row (id=1) holding global game state."""
    __tablename__ = "game_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    round_state: Mapped[RoundStateEnum] = mapped_column(
        Enum(RoundStateEnum, name="round_state_enum"),
        default=RoundStateEnum.idle,
        nullable=False,
    )
    tournament_winner: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    data_source: Mapped[str] = mapped_column(String(20), default="manual", nullable=False, server_default="manual")
    current_stage: Mapped[int] = mapped_column(Integer, default=1, nullable=False, server_default="1")
    # Snapshot of the leaderboard standings at the moment the current stage
    # opened (i.e. the END of the previous stage): {"stage": N, "ranks": {entry_id: rank}}.
    # Lets the leaderboard show per-stage rank movement (+N up / -N down). NULL
    # during stage 1 (no previous stage to compare against).
    stage_baseline: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)


class DailyRankSnapshot(Base):
    """One rank row per entry per calendar day (US Central time).

    Taken automatically at the first leaderboard request after midnight CT.
    Used to show daily rank-change arrows on the leaderboard.
    """
    __tablename__ = "daily_rank_snapshots"
    __table_args__ = (UniqueConstraint("snapshot_date", "entry_id", name="uq_daily_rank_snapshot"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    snapshot_date: Mapped[object] = mapped_column(Date, nullable=False, index=True)
    entry_id: Mapped[str] = mapped_column(String(36), nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)


class LiveMatch(Base):
    """In-play match — score and minute, cleared when admin clicks FINAL."""
    __tablename__ = "live_matches"

    match_n: Mapped[int] = mapped_column(Integer, primary_key=True)
    score_a: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    score_b: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    minute: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    # TRUE only when admin pressed ▶ LIVE in the Results tab. Saved-but-not-LIVE
    # scores still feed the leaderboard; the flag controls the LIVE badge.
    is_live: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    # Knockout extra time / penalties (mirrors Result) — for in-play KO matches.
    et_a: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    et_b: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    pen_a: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    pen_b: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    # "a" or "b" — auto-derived from pens → ET → 90-min score.
    winner: Mapped[Optional[str]] = mapped_column(String(1), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
