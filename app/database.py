import ssl

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import settings

# NullPool is required for serverless environments (Vercel) — each request
# opens and closes its own connection rather than borrowing from a pool.
_connect_args: dict = {}
if settings.database_ssl:
    _ssl_ctx = ssl.create_default_context()
    _connect_args["ssl"] = _ssl_ctx

engine = create_async_engine(
    settings.database_url,
    poolclass=NullPool,
    connect_args=_connect_args,
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
    """FastAPI dependency — yields an async DB session."""
    async with AsyncSessionLocal() as session:
        yield session
