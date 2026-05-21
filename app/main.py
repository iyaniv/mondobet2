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
    """Create tables + admin user + game config singleton on first run."""
    from app import crud
    from app.models import GameConfig, RoundStateEnum

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        # Ensure config singleton exists
        await crud.get_config(db)

        # Ensure admin user exists
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
