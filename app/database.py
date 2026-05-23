from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import settings

# NullPool: Vercel is serverless — no persistent connections needed.
# statement_cache_size=0: required for Neon's PgBouncer pooler (transaction mode
# doesn't support prepared statements).
# SSL is handled by sslmode=require in the DATABASE_URL.
engine = create_async_engine(
    settings.database_url,
    poolclass=NullPool,
    connect_args={"ssl": "require", "statement_cache_size": 0},
    echo=settings.database_echo,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
