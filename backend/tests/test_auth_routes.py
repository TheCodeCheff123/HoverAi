"""Tests for POST /api/v1/auth/ routes — signup, signin, refresh, signout."""

import pytest
from fastapi.testclient import TestClient


class TestSignup:
    """Integration tests for POST /api/v1/auth/signup."""

    def test_signup_returns_201_and_tokens(self, client: TestClient):
        """Successful signup returns HTTP 201, access_token, and refresh_token."""
        resp = client.post(
            "/api/v1/auth/signup",
            json={
                "email": "test@example.com",
                "full_name": "Test User",
                "password": "strongpassword1",
                "language": "en-pidgin",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert "access_token" in body
        assert "refresh_token" in body
        assert body["token_type"] == "bearer"
        assert len(body["access_token"]) > 20
        assert len(body["refresh_token"]) == 128  # 64-byte hex = 128 chars

    def test_duplicate_email_returns_409(self, client: TestClient):
        """Registering the same email twice returns HTTP 409 Conflict."""
        payload = {
            "email": "duplicate@example.com",
            "full_name": "Dup User",
            "password": "strongpassword1",
            "language": "en",
        }
        first = client.post("/api/v1/auth/signup", json=payload)
        assert first.status_code == 201

        second = client.post("/api/v1/auth/signup", json=payload)
        assert second.status_code == 409
        assert "already exists" in second.json()["detail"]

    def test_short_password_returns_422(self, client: TestClient):
        """Password shorter than 8 chars fails Pydantic validation (HTTP 422)."""
        resp = client.post(
            "/api/v1/auth/signup",
            json={
                "email": "short@example.com",
                "full_name": "Short Pw",
                "password": "abc",
                "language": "en",
            },
        )
        assert resp.status_code == 422

    def test_invalid_email_returns_422(self, client: TestClient):
        """An invalid email address fails Pydantic validation (HTTP 422)."""
        resp = client.post(
            "/api/v1/auth/signup",
            json={
                "email": "not-an-email",
                "full_name": "Bad Email",
                "password": "strongpassword1",
                "language": "en",
            },
        )
        assert resp.status_code == 422


class TestSignin:
    """Integration tests for POST /api/v1/auth/signin."""

    def test_signin_with_correct_credentials_returns_tokens(self, client: TestClient):
        """Signing in with valid credentials returns HTTP 200, access + refresh token."""
        client.post(
            "/api/v1/auth/signup",
            json={
                "email": "signin@example.com",
                "full_name": "Sign In User",
                "password": "mypassword123",
                "language": "yo",
            },
        )
        resp = client.post(
            "/api/v1/auth/signin",
            json={"email": "signin@example.com", "password": "mypassword123"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert "refresh_token" in body
        assert len(body["refresh_token"]) == 128

    def test_signin_wrong_password_returns_401(self, client: TestClient):
        """Wrong password returns HTTP 401 Unauthorized."""
        client.post(
            "/api/v1/auth/signup",
            json={
                "email": "wrongpw@example.com",
                "full_name": "Wrong Pw",
                "password": "correctpassword",
                "language": "en",
            },
        )
        resp = client.post(
            "/api/v1/auth/signin",
            json={"email": "wrongpw@example.com", "password": "wrongpassword"},
        )
        assert resp.status_code == 401

    def test_signin_unknown_email_returns_401(self, client: TestClient):
        """Email that was never registered returns HTTP 401 Unauthorized."""
        resp = client.post(
            "/api/v1/auth/signin",
            json={"email": "ghost@example.com", "password": "anything"},
        )
        assert resp.status_code == 401

    def test_signin_with_oauth2_form_fields(self, client: TestClient):
        """Signing in via OAuth2 form fields (Swagger Authorize dialog) works."""
        client.post(
            "/api/v1/auth/signup",
            json={
                "email": "formlogin@example.com",
                "full_name": "Form Login",
                "password": "formpassword1",
                "language": "en",
            },
        )
        resp = client.post(
            "/api/v1/auth/signin",
            data={"username": "formlogin@example.com", "password": "formpassword1"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert "refresh_token" in body


class TestRefresh:
    """Integration tests for POST /api/v1/auth/refresh."""

    def test_refresh_returns_new_token_pair(self, client: TestClient):
        """A valid refresh token exchanges for a new access + refresh token pair."""
        signup_resp = client.post(
            "/api/v1/auth/signup",
            json={
                "email": "refresh@example.com",
                "full_name": "Refresh User",
                "password": "refreshpass1",
                "language": "en",
            },
        )
        original_refresh = signup_resp.json()["refresh_token"]

        resp = client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": original_refresh},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert "refresh_token" in body
        # Refresh token must rotate (new opaque value each time)
        assert body["refresh_token"] != original_refresh

    def test_refresh_old_token_is_revoked_after_rotation(self, client: TestClient):
        """After rotation, the old refresh token is rejected with 401."""
        signup_resp = client.post(
            "/api/v1/auth/signup",
            json={
                "email": "rotate@example.com",
                "full_name": "Rotate User",
                "password": "rotatepass1",
                "language": "en",
            },
        )
        original_refresh = signup_resp.json()["refresh_token"]

        # First use — succeeds and rotates
        client.post("/api/v1/auth/refresh", json={"refresh_token": original_refresh})

        # Second use of the same (now-revoked) token — must fail
        resp = client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": original_refresh},
        )
        assert resp.status_code == 401

    def test_refresh_with_invalid_token_returns_401(self, client: TestClient):
        """A completely made-up refresh token returns HTTP 401."""
        resp = client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": "a" * 128},
        )
        assert resp.status_code == 401


class TestSignout:
    """Integration tests for POST /api/v1/auth/signout."""

    def test_signout_revokes_refresh_token(self, client: TestClient):
        """After signout, the refresh token can no longer be used."""
        signup_resp = client.post(
            "/api/v1/auth/signup",
            json={
                "email": "signout@example.com",
                "full_name": "Signout User",
                "password": "signoutpass1",
                "language": "en",
            },
        )
        refresh_token = signup_resp.json()["refresh_token"]

        # Sign out
        signout_resp = client.post(
            "/api/v1/auth/signout",
            json={"refresh_token": refresh_token},
        )
        assert signout_resp.status_code == 204

        # Attempt to use the revoked refresh token — must fail
        resp = client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": refresh_token},
        )
        assert resp.status_code == 401

    def test_signout_is_idempotent(self, client: TestClient):
        """Signing out twice with the same token returns 204 both times."""
        signup_resp = client.post(
            "/api/v1/auth/signup",
            json={
                "email": "idem@example.com",
                "full_name": "Idem User",
                "password": "idempassword1",
                "language": "en",
            },
        )
        refresh_token = signup_resp.json()["refresh_token"]

        first = client.post("/api/v1/auth/signout", json={"refresh_token": refresh_token})
        second = client.post("/api/v1/auth/signout", json={"refresh_token": refresh_token})
        assert first.status_code == 204
        assert second.status_code == 204
