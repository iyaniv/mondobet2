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


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str
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


class ConfigUpdate(BaseModel):
    round_state: Optional[str] = None
    tournament_winner: Optional[str] = None
    data_source: Optional[str] = None


# ── Entries ───────────────────────────────────────────────────────────────────

class EntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    created_at: datetime
    submitted_at: Optional[datetime] = None


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
    score_a: Optional[int] = Field(None, ge=0, le=99)
    score_b: Optional[int] = Field(None, ge=0, le=99)


class ResultOut(BaseModel):
    match_n: int
    score_a: int
    score_b: int


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
    score_a: int = Field(0, ge=0, le=99)
    score_b: int = Field(0, ge=0, le=99)
    minute: int = Field(0, ge=0, le=120)


class LiveMatchOut(BaseModel):
    match_n: int
    score_a: int
    score_b: int
    minute: int


# ── User profile update ───────────────────────────────────────────────────────

class UserProfileUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
