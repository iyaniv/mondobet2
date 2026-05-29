"""
WC2026 Predictions API — FastAPI async application.

Local dev:
    uvicorn app.main:app --reload

Docs: http://localhost:8000/docs
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine, AsyncSessionLocal
from app.routers import auth, config, entries, init, leaderboard, live, matches, predictions, results, users


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
        # Migration 11: result_audit table (admin result-edit log). This is a
        # whole new table, so Base.metadata.create_all above already creates it
        # on cold start — no ALTER needed. Statement kept for parity with the
        # numbered SQL migration and explicitness on older Postgres.
        await conn.execute(text(
            "CREATE TABLE IF NOT EXISTS result_audit ("
            " id SERIAL PRIMARY KEY,"
            " match_n INT,"
            " action VARCHAR(20) NOT NULL,"
            " old_value VARCHAR(160),"
            " new_value VARCHAR(160),"
            " admin_id INT REFERENCES users (id) ON DELETE SET NULL,"
            " admin_name VARCHAR(100) NOT NULL DEFAULT '',"
            " created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
        ))
        # Migration 12: per-stage leaderboard movement — snapshot of standings
        # at the start of the current stage, stored on game_config.
        await conn.execute(text(
            "ALTER TABLE game_config ADD COLUMN IF NOT EXISTS stage_baseline JSONB"
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

for router in [auth, config, entries, init, leaderboard, live, matches, predictions, results, users]:
    app.include_router(router.router, prefix="/api")


@app.get("/api/health", tags=["health"])
async def health():
    return {"status": "ok"}
