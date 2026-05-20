import ssl

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

_connect_args: dict = {}
if settings.database_ssl:
    _ssl_ctx = ssl.create_default_context()
    _connect_args["ssl"] = _ssl_ctx

# Small persistent pool — warm Vercel instances reuse an open connection
# instead of opening a new TLS handshake on every request (which cost ~300ms).
# pool_size=1  : keep one connection alive per process
# max_overflow=4: allow short bursts
# pool_recycle  : refresh before Neon's idle timeout (~5 min)
engine = create_async_engine(
    settings.database_url,
    pool_size=1,
    max_overflow=4,
    pool_pre_ping=True,
    pool_recycle=280,
    pool_timeout=10,
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
    async with AsyncSessionLocal() as session:
        yield session
