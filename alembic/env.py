"""
Alembic migration environment.

Uses a *synchronous* psycopg2 connection for migrations (simpler than async),
derived from the async DATABASE_URL in .env by swapping the driver prefix.
"""

import sys
from pathlib import Path
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Ensure project root is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings   # noqa: E402
from app.database import Base     # noqa: E402
import app.models                 # noqa: F401, E402  — registers models with Base.metadata

# Convert async URL → sync URL for Alembic
# e.g. postgresql+asyncpg://... → postgresql+psycopg2://...
_sync_url = settings.database_url.replace("+asyncpg", "+psycopg2")

config = context.config
config.set_main_option("sqlalchemy.url", _sync_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=_sync_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
