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
    created_at: datetime


class AuthResponse(BaseModel):
    user: UserOut
    token: str


# ── Game Config ───────────────────────────────────────────────────────────────

class ConfigOut(BaseModel):
    round_state: str
    tournament_winner: Optional[str]


class ConfigUpdate(BaseModel):
    round_state: Optional[str] = None
    tournament_winner: Optional[str] = None


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
