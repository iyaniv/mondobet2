"""Pydantic v2 schemas for WC2026 Predictions API."""

from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


# ── Auth ──────────────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=1, max_length=200)
    password: str = Field(..., min_length=4)
    phone: str = Field(..., min_length=7, max_length=50)


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str
    phone: str = ""
    is_admin: bool
    has_paid: bool
    locked_winner: Optional[str] = None
    created_at: datetime


class AuthResponse(BaseModel):
    user: UserOut
    token: str


# ── Game Config ───────────────────────────────────────────────────────────────

class ConfigOut(BaseModel):
    round_state: str
    tournament_winner: Optional[str]
    data_source: str = "manual"
    current_stage: int = 1


class ConfigUpdate(BaseModel):
    round_state: Optional[str] = None
    tournament_winner: Optional[str] = None
    data_source: Optional[str] = None
    current_stage: Optional[int] = None


# ── Entries ───────────────────────────────────────────────────────────────────

class EntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    created_at: datetime
    submitted_at: Optional[datetime] = None
    stages_submitted: dict = {}


class EntryCreate(BaseModel):
    name: Optional[str] = None  # auto-named if omitted
    copy_from_entry_id: Optional[str] = None


class EntryRename(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


# ── Predictions ───────────────────────────────────────────────────────────────

class PredictionIn(BaseModel):
    score_a: Optional[int] = Field(None, ge=0, le=99)
    score_b: Optional[int] = Field(None, ge=0, le=99)


class PredictionOut(BaseModel):
    match_n: int
    score_a: Optional[int]
    score_b: Optional[int]


class WinnerPickIn(BaseModel):
    team: Optional[str] = None


# ── Results ───────────────────────────────────────────────────────────────────

class ResultIn(BaseModel):
    score_a: Optional[int] = Field(None, ge=0, le=99)   # 90-min score (for points)
    score_b: Optional[int] = Field(None, ge=0, le=99)
    # Knockout rounds only — score after extra time + penalty shootout.
    # winner is derived server-side from these; clients don't send it.
    et_a: Optional[int] = Field(None, ge=0, le=99)
    et_b: Optional[int] = Field(None, ge=0, le=99)
    pen_a: Optional[int] = Field(None, ge=0, le=99)
    pen_b: Optional[int] = Field(None, ge=0, le=99)


class ResultOut(BaseModel):
    match_n: int
    score_a: int
    score_b: int
    et_a: Optional[int] = None
    et_b: Optional[int] = None
    pen_a: Optional[int] = None
    pen_b: Optional[int] = None
    winner: Optional[str] = None


# ── Users (admin) ─────────────────────────────────────────────────────────────

class UserPatch(BaseModel):
    has_paid: Optional[bool] = None


# ── Leaderboard ───────────────────────────────────────────────────────────────

class LeaderboardEntry(BaseModel):
    entry_id: str
    user_id: int
    name: str
    total: int
    exact: int
    correct_dir: int
    scored_matches: int
    winner_pick: Optional[str]
    winner_bonus: int
    has_paid: bool
    submitted_count: int
    live_points: int
    live_matches_count: int


# ── Live matches ──────────────────────────────────────────────────────────────

class LiveMatchIn(BaseModel):
    # All fields optional so PATCH-style partial updates don't clobber scores
    # when the client only wants to flip the is_live flag (or vice-versa).
    score_a: Optional[int] = Field(None, ge=0, le=99)
    score_b: Optional[int] = Field(None, ge=0, le=99)
    minute: Optional[int] = Field(None, ge=0, le=120)
    is_live: Optional[bool] = None
    et_a: Optional[int] = Field(None, ge=0, le=99)
    et_b: Optional[int] = Field(None, ge=0, le=99)
    pen_a: Optional[int] = Field(None, ge=0, le=99)
    pen_b: Optional[int] = Field(None, ge=0, le=99)


class LiveMatchOut(BaseModel):
    match_n: int
    score_a: int
    score_b: int
    minute: int
    is_live: bool = False
    et_a: Optional[int] = None
    et_b: Optional[int] = None
    pen_a: Optional[int] = None
    pen_b: Optional[int] = None
    winner: Optional[str] = None


# ── User profile update ───────────────────────────────────────────────────────

class UserProfileUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
