"""Users routes — GET /api/v1/users/me, GET/PATCH /api/v1/users/me/settings."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth import get_current_user
from app.db import get_session
from app.models.models import User, UserSettings
from app.schemas.users import UserResponse, UserSettingsResponse, UserSettingsUpdate

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    """Return the authenticated user's public profile.

    Args:
        current_user: ``User`` instance injected by ``get_current_user``.

    Returns:
        A ``UserResponse`` with the user's profile fields.
    """
    return UserResponse(
        id=str(current_user.id),
        email=current_user.email,
        full_name=current_user.full_name,
        language=current_user.language,
    )


@router.get("/me/settings", response_model=UserSettingsResponse)
async def get_settings(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserSettingsResponse:
    """Return the authenticated user's app settings.

    Args:
        current_user: ``User`` instance injected by ``get_current_user``.
        session: Async database session injected by ``get_session``.

    Returns:
        A ``UserSettingsResponse`` with the current settings values.

    Raises:
        HTTPException 404: If the settings row does not exist (should not
            happen — signup always creates a default row).
    """
    result = await session.execute(
        select(UserSettings).where(UserSettings.user_id == current_user.id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Settings not found for this user.",
        )
    return UserSettingsResponse.model_validate(row)


@router.patch("/me/settings", response_model=UserSettingsResponse)
async def update_settings(
    body: UserSettingsUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserSettingsResponse:
    """Partially update the authenticated user's app settings.

    Only fields present in the request body are updated (PATCH semantics).
    Fields omitted retain their current values.

    Args:
        body: Partial settings update — only non-None fields are applied.
        current_user: ``User`` instance injected by ``get_current_user``.
        session: Async database session injected by ``get_session``.

    Returns:
        A ``UserSettingsResponse`` reflecting the updated settings.

    Raises:
        HTTPException 400: If no fields are provided in the request body.
        HTTPException 404: If the settings row does not exist.
    """
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields provided to update.",
        )

    result = await session.execute(
        select(UserSettings).where(UserSettings.user_id == current_user.id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Settings not found for this user.",
        )

    for field, value in updates.items():
        setattr(row, field, value)

    session.add(row)
    await session.flush()
    await session.refresh(row)
    return UserSettingsResponse.model_validate(row)
