"""Auth routes — signup, signin, refresh, signout.

Route prefix: /api/v1/auth (set in app/api/v1/router.py)

Token strategy:
  - Access token:  short-lived JWT (15 min). Sent as Authorization: Bearer.
  - Refresh token: long-lived opaque random hex (90 days) stored in DB.
    The client stores it securely (Electron safeStorage) and calls
    POST /auth/refresh when the access token expires. Users never need to
    re-enter their password for the lifetime of the refresh token.

Swagger auto-authorize:
  POST /auth/signin accepts both JSON body and OAuth2 form fields so that
  the Swagger UI "Authorize" dialog works out of the box. After a successful
  call the custom JS in main.py automatically stores the returned Bearer token.
"""

import logging

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)
from app.db import get_session
from app.models.models import RefreshToken, User, UserSettings
from app.schemas.auth import (
    RefreshRequest,
    SigninRequest,
    SignoutRequest,
    SignupRequest,
    TokenResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _issue_tokens(
    user: User,
    device_id: str | None,
    session: AsyncSession,
) -> TokenResponse:
    """Create and persist a new access + refresh token pair for a user.

    This helper is shared between signup, signin, and refresh so that token
    issuance logic lives in exactly one place (SRP).

    Args:
        user: The authenticated ``User`` instance.
        device_id: Optional client identifier (e.g. ``"electron-linux"``).
        session: Async database session — refresh token row is flushed here.

    Returns:
        A ``TokenResponse`` with the new access and refresh tokens.
    """
    access_token = create_access_token({"sub": str(user.id)})
    raw_refresh, expires_at = create_refresh_token()

    session.add(
        RefreshToken(
            user_id=user.id,
            token=raw_refresh,
            device_id=device_id,
            expires_at=expires_at,
        )
    )
    await session.flush()
    return TokenResponse(access_token=access_token, refresh_token=raw_refresh)


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def signup(
    body: SignupRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """Create a new user account and return an access + refresh token pair.

    Inserts a ``User`` row, a default ``UserSettings`` row, and a
    ``RefreshToken`` row within a single transaction.

    Args:
        body: Validated signup payload — email, full_name, password, language,
              optional device_id.
        session: Async database session injected by ``get_session``.

    Returns:
        A ``TokenResponse`` containing access and refresh tokens.

    Raises:
        HTTPException 409: If the email address is already registered.
    """
    user = User(
        email=body.email,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
        language=body.language,
    )
    session.add(user)

    try:
        await session.flush()
    except IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    session.add(UserSettings(user_id=user.id))
    await session.flush()
    await session.refresh(user)

    tokens = await _issue_tokens(user, body.device_id, session)
    logger.info("New user registered: %s", body.email)
    return tokens


@router.post("/signin", response_model=TokenResponse)
async def signin(
    request: Request,
    # OAuth2 form fields — present when Swagger UI "Authorize" dialog submits
    username: str | None = Form(default=None),
    password: str | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """Authenticate an existing user and return an access + refresh token pair.

    Accepts two input formats so both the Electron app (JSON) and the Swagger
    UI "Authorize" dialog (OAuth2 form) work through the same route:

    - **JSON body**: ``{"email": "...", "password": "..."}``
    - **Form fields**: ``username=<email>&password=<password>`` (OAuth2 spec)

    Returns the same 401 for both "not found" and "wrong password" to avoid
    leaking whether an email is registered.

    Args:
        request: The raw Starlette request — used to read JSON body when the
                 content-type is ``application/json``.
        username: OAuth2 form email field (maps to email).
        password: OAuth2 form password field.
        session: Async database session injected by ``get_session``.

    Returns:
        A ``TokenResponse`` containing access and refresh tokens.

    Raises:
        HTTPException 401: If the email is not found or password is wrong.
        HTTPException 422: If neither JSON body nor form fields are provided.
    """
    invalid_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Resolve credentials from whichever input format was sent
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        # JSON body — used by the Electron app
        try:
            raw = await request.json()
            json_body = SigninRequest(**raw)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid JSON body.",
            )
        email: str = json_body.email
        plain_password: str = json_body.password
        device_id: str | None = json_body.device_id
    elif username is not None and password is not None:
        # Form fields — used by Swagger UI "Authorize" dialog
        email = username
        plain_password = password
        device_id = None
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide either a JSON body or form fields (username + password).",
        )

    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(plain_password, user.hashed_password):
        raise invalid_exc

    return await _issue_tokens(user, device_id, session)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    body: RefreshRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """Exchange a valid refresh token for a new access + refresh token pair.

    **Token rotation**: the submitted refresh token is revoked and a brand-new
    pair is issued. This limits the damage if a refresh token is ever leaked —
    the attacker can only use it once before the legitimate client rotates it.

    The Electron app should:
    1. Catch a 401 on any API call.
    2. Call ``POST /auth/refresh`` with the stored refresh token.
    3. If successful, store the new tokens and retry the original request.
    4. If this call also returns 401, clear tokens and show the login screen.

    Args:
        body: Contains the opaque refresh token string.
        session: Async database session injected by ``get_session``.

    Returns:
        A new ``TokenResponse`` with rotated access and refresh tokens.

    Raises:
        HTTPException 401: If the token is not found, already revoked, or expired.
    """
    from datetime import UTC, datetime  # local import — only needed here

    result = await session.execute(
        select(RefreshToken).where(RefreshToken.token == body.refresh_token)
    )
    stored = result.scalar_one_or_none()

    if stored is None or stored.revoked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked refresh token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Make stored.expires_at timezone-aware for comparison if stored naive
    expires_at = stored.expires_at
    if expires_at.tzinfo is None:
        from datetime import timezone
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at < datetime.now(UTC):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Revoke the current token (rotation — use-once semantics)
    stored.revoked = True
    session.add(stored)
    await session.flush()

    # Fetch the user and issue a fresh pair
    user_result = await session.execute(
        select(User).where(User.id == stored.user_id)
    )
    user = user_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return await _issue_tokens(user, stored.device_id, session)


@router.post("/signout", status_code=status.HTTP_204_NO_CONTENT)
async def signout(
    body: SignoutRequest,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Revoke a refresh token, effectively signing the user out on that device.

    The access token is short-lived (15 min) and stateless — it cannot be
    invalidated server-side. The client should discard it immediately on
    sign-out. The refresh token is revoked here so it cannot be used to obtain
    new tokens after sign-out.

    Args:
        body: Contains the refresh token to revoke.
        session: Async database session injected by ``get_session``.

    Returns:
        204 No Content on success. Also returns 204 if the token was not found
        (idempotent — signing out twice should not be an error).
    """
    result = await session.execute(
        select(RefreshToken).where(RefreshToken.token == body.refresh_token)
    )
    stored = result.scalar_one_or_none()

    if stored is not None and not stored.revoked:
        stored.revoked = True
        session.add(stored)
        await session.flush()
        logger.info("Refresh token revoked for user_id=%s", stored.user_id)
