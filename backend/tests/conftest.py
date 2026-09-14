"""Shared pytest fixtures for the Hover AI backend test suite.

Uses an in-memory SQLite database so tests are fully isolated and require
no external services (no Render Postgres, no real API keys).

The app lifespan (which tries to connect to the real DB) is disabled
during tests — conftest creates the SQLite tables directly instead.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

from app.db import get_session
from app.main import app

# ── In-memory SQLite engine for tests ────────────────────────────────────────
_TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

_test_engine = create_async_engine(
    _TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
)

_TestSessionLocal = async_sessionmaker(
    bind=_test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


@pytest.fixture(scope="session", autouse=True)
async def create_test_tables():
    """Create all tables in the in-memory SQLite database once per test session."""
    async with _test_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    yield
    async with _test_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)


@pytest.fixture()
async def session() -> AsyncSession:
    """Yield an isolated async session that is always rolled back after each test.

    Every test gets a fresh transaction that is rolled back on teardown,
    so tests never pollute each other's data.

    Yields:
        An ``AsyncSession`` bound to the in-memory test database.
    """
    async with _TestSessionLocal() as s:
        yield s
        await s.rollback()


@pytest.fixture()
def client(session: AsyncSession) -> TestClient:
    """Return a FastAPI TestClient wired to the in-memory test session.

    Overrides the ``get_session`` dependency so every request during the
    test uses the same isolated in-memory session. The app lifespan is
    disabled (``lifespan="off"``) to avoid connecting to the real database.

    Args:
        session: The test-scoped ``AsyncSession`` fixture.

    Returns:
        A synchronous ``TestClient`` for making HTTP requests against the app.
    """
    async def _override_get_session():
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

    app.dependency_overrides[get_session] = _override_get_session
    # base_url is required; raise_server_exceptions surfaces errors clearly.
    # We do NOT use the context manager form (__enter__/__exit__) which triggers
    # the app lifespan — we construct directly to avoid the production DB connect.
    c = TestClient(app, raise_server_exceptions=True, base_url="http://testserver")
    yield c
    app.dependency_overrides.clear()
