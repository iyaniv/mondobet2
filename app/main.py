"""
WC2026 Predictions API — FastAPI async application.

Local dev:
    uvicorn app.main:app --reload

Docs: http://localhost:8000/docs
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import hash_password, verify_password
from app.config import settings
from app.database import Base, engine, AsyncSessionLocal
from app.routers import admin, auth, config, entries, init, leaderboard, live, matches, predictions, results, users


async def _bootstrap():
    """Create tables + admin user + game config singleton on first run.

    Also runs incremental migrations (ALTER TABLE … ADD COLUMN IF NOT EXISTS)
    so existing databases pick up new columns automatically on deploy.
    All statements are idempotent — safe to run on every cold start.
    """
    from app import crud
    from sqlalchemy import text

    async with engine.begin() as conn:
        # Create any missing tables (new installs)
        await conn.run_sync(Base.metadata.create_all)

        # ── Incremental column migrations ──────────────────────────────────
        # Migration 08: winner column for knockout-stage results (ET/penalties)
        await conn.execute(text(
            "ALTER TABLE results ADD COLUMN IF NOT EXISTS winner CHAR(1)"
        ))
        await conn.execute(text(
            "ALTER TABLE live_matches ADD COLUMN IF NOT EXISTS winner CHAR(1)"
        ))
        # Migration 09: extra-time + penalty-shootout scores (knockout matches)
        for tbl in ("results", "live_matches"):
            for col in ("et_a", "et_b", "pen_a", "pen_b"):
                await conn.execute(text(
                    f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS {col} SMALLINT"
                ))
        # Migration 10: per-user onboarding-popup state. Lives on the users
        # row as JSONB so the popups don't re-trigger on a new device/browser.
        await conn.execute(text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS help_seen JSONB "
            "NOT NULL DEFAULT '{}'::jsonb"
        ))
        # Migration 12: per-stage leaderboard movement — snapshot of standings
        # at the start of the current stage, stored on game_config.
        await conn.execute(text(
            "ALTER TABLE game_config ADD COLUMN IF NOT EXISTS stage_baseline JSONB"
        ))
        # Migration 13: per-entry snapshot of the last submitted state, for the
        # "Reset draft" feature.
        await conn.execute(text(
            "ALTER TABLE entries ADD COLUMN IF NOT EXISTS submitted_snapshot JSONB"
        ))
        # One-time backfill: forms cleanly submitted for the CURRENT stage get a
        # snapshot from their current predictions (== their last submission).
        # Forms mid-edit (submitted then edited → stage flag cleared) are skipped,
        # so their draft flow only begins at the next submit. Idempotent: only
        # fills NULL snapshots.
        await conn.execute(text("""
            WITH cfg AS (SELECT COALESCE(current_stage, 1) AS stage FROM game_config WHERE id = 1),
            clean AS (
                SELECT e.id FROM entries e, cfg
                WHERE e.submitted_snapshot IS NULL
                  AND e.submitted_at IS NOT NULL
                  AND jsonb_exists(e.stages_submitted, cfg.stage::text)
            )
            UPDATE entries e
            SET submitted_snapshot = jsonb_build_object(
                'at', to_jsonb(e.submitted_at),
                'winner', (SELECT to_jsonb(wp.team) FROM winner_picks wp WHERE wp.entry_id = e.id),
                'preds', COALESCE((
                    SELECT jsonb_object_agg(p.match_n::text, jsonb_build_array(p.score_a, p.score_b))
                    FROM predictions p
                    WHERE p.entry_id = e.id AND p.score_a IS NOT NULL AND p.score_b IS NOT NULL
                ), '{}'::jsonb))
            FROM clean WHERE e.id = clean.id
        """))
        # Migration 14: red-card counts per side on a live match (UI signal
        # only, not scored). Cleared when the match finalizes into `results`.
        for col in ("red_a", "red_b"):
            await conn.execute(text(
                f"ALTER TABLE live_matches ADD COLUMN IF NOT EXISTS {col} SMALLINT"
            ))

    async with AsyncSessionLocal() as db:
        await crud.get_config(db)
        admin = await crud.get_user_by_email(db, settings.admin_email.lower())
        if not admin:
            await crud.create_user(
                db,
                name="Admin",
                email=settings.admin_email.lower(),
                password=settings.admin_password,
                is_admin=True,
            )
        else:
            # Allow rotating the admin password via the ADMIN_PASSWORD env var.
            # Boot only *creates* the admin, so without this the password could
            # never be changed (there's no in-app change-password). We act ONLY
            # when ADMIN_PASSWORD is explicitly set (not the default) and differs,
            # so this is a no-op for deployments that don't set it.
            env_pw = os.environ.get("ADMIN_PASSWORD")
            if env_pw and not verify_password(env_pw, admin.password_hash):
                admin.password_hash = hash_password(env_pw)
                await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _bootstrap()
    yield
    await engine.dispose()


app = FastAPI(
    title="WC2026 Predictions API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in [admin, auth, config, entries, init, leaderboard, live, matches, predictions, results, users]:
    app.include_router(router.router, prefix="/api")


@app.get("/api/health", tags=["health"])
async def health():
    return {"status": "ok"}
