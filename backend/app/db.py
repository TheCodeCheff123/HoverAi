"""Database session management.

Provides an async SQLAlchemy engine, session factory, and a FastAPI
dependency (``get_session``) that yields one session per request.

The engine is created once at module import time using the DATABASE_URL
from settings. The lifespan handler in ``main.py`` calls
``create_db_and_tables()`` on startup.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

from app.config import settings

# Convert standard postgres:// URL to the asyncpg driver scheme
# Render provides postgresql:// — asyncpg needs postgresql+asyncpg://
_db_url = settings.database_url.replace(
    "postgresql://", "postgresql+asyncpg://", 1
).replace(
    "postgres://", "postgresql+asyncpg://", 1
)

engine = create_async_engine(
    _db_url,
    echo=False,        # Set True temporarily to debug SQL queries
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

# Session factory — used by get_session dependency
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def create_db_and_tables() -> None:
    """Create all SQLModel tables if they do not already exist.

    Called once during FastAPI application startup (lifespan).
    In production, prefer running ``migrations/001_initial.sql`` manually
    against the Render database — this is a safety net for development.
    """
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields an async database session.

    Yields one ``AsyncSession`` per request. On success the session is
    committed automatically; on any unhandled exception it is rolled back
    before being closed, ensuring no partial writes reach the database.

    Yields:
        An ``AsyncSession`` bound to the shared engine.

    Raises:
        Re-raises any exception from the route handler after rolling back.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
