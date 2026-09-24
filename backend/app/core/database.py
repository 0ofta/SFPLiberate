"""Database configuration and session management."""

from collections.abc import AsyncGenerator

import structlog
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

logger = structlog.get_logger()

settings = get_settings()

# Create async engine
engine = create_async_engine(
    settings.database_url,
    echo=settings.database_echo,
    future=True,
)

# Create session maker
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting async database sessions."""
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


def _add_missing_columns_sync(conn: Connection) -> None:
    """
    Add columns that exist on the ORM model but not yet on the live table.

    create_all() only creates missing tables, never alters existing ones, so
    a column added to a model after the table already exists (e.g. on an
    existing user's SQLite volume) needs this instead. Deliberately minimal -
    only handles "add a new nullable column", not renames/drops/type changes.
    This project has no Alembic (see CLAUDE.md); this covers the common case
    without requiring a full migration framework.
    """
    from app.models.module import SFPModule

    inspector = inspect(conn)
    if SFPModule.__tablename__ not in inspector.get_table_names():
        return  # create_all() will create it fresh, with all current columns

    existing_columns = {col["name"] for col in inspector.get_columns(SFPModule.__tablename__)}
    for column in SFPModule.__table__.columns:
        if column.name in existing_columns:
            continue
        column_type = column.type.compile(dialect=conn.dialect)
        conn.execute(
            text(f"ALTER TABLE {SFPModule.__tablename__} ADD COLUMN {column.name} {column_type}")
        )
        logger.info("column_added", table=SFPModule.__tablename__, column=column.name)


async def init_db() -> None:
    """Initialize database (create tables, then patch in any new columns)."""
    from app.models.module import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns_sync)
