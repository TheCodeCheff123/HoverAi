"""API v1 router — aggregates all v1 endpoints under /api/v1.

Adding a v2 in the future is as simple as creating app/api/v2/router.py
and mounting it in main.py alongside this one.
"""

from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends
from app.db import get_session

from app.routers import agent, auth, query, users

router = APIRouter()

router.include_router(auth.router, prefix="/auth", tags=["auth"])
router.include_router(users.router, prefix="/users", tags=["users"])
router.include_router(query.router, prefix="/query", tags=["query"])
router.include_router(agent.router, prefix="/agent", tags=["agent"])


@router.get("/health", tags=["meta"])
async def health(session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    """Return service liveness and database connectivity status.

    Runs a lightweight ``SELECT 1`` against the database so the health
    endpoint reflects both application and database health.

    Args:
        session: Async database session injected by ``get_session``.

    Returns:
        A JSON object with ``status``, ``version``, and ``db`` fields.
    """
    try:
        await session.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:  # noqa: BLE001 — intentional catch-all for health check
        db_status = "unavailable"

    return {"status": "ok", "version": "0.1.0", "db": db_status}
