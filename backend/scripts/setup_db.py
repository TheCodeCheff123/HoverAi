#!/usr/bin/env python3
"""Local database setup script.

Creates all tables defined in app/models/models.py against the database
specified in the .env file (or DATABASE_URL environment variable).

Usage:
    cd backend/
    uv run python scripts/setup_db.py

The script is safe to run multiple times — all CREATE TABLE statements
use IF NOT EXISTS so existing data is never touched.
"""

import asyncio
import sys
from pathlib import Path

# Make sure the backend/ package root is on sys.path when run directly
sys.path.insert(0, str(Path(__file__).parent.parent))


async def main() -> None:
    """Create all SQLModel tables in the target database.

    Reads DATABASE_URL from the .env file via app.config.settings.
    Prints each step so you can see what is happening.
    """
    # Import here so path insertion above takes effect first
    from app.config import settings  # noqa: PLC0415
    from app.db import create_db_and_tables, engine  # noqa: PLC0415
    from app.models import models as _models_module  # noqa: PLC0415, F401

    # Trigger import of all model classes so SQLModel.metadata knows about them
    _ = _models_module

    db_url_display = settings.database_url.split("@")[-1]  # hide credentials
    print(f"Connecting to: ...@{db_url_display}")
    print("Creating tables (IF NOT EXISTS) ...")

    try:
        await create_db_and_tables()
        print()
        print("Tables created successfully:")
        from sqlmodel import SQLModel  # noqa: PLC0415
        for table_name in sorted(SQLModel.metadata.tables.keys()):
            print(f"  ✓ {table_name}")
        print()
        print("Done. Your database is ready.")
    except Exception as exc:
        print(f"\n✗ Database setup failed: {exc}")
        print("\nCheck that:")
        print("  1. DATABASE_URL in .env is correct")
        print("  2. The Render PostgreSQL instance is running")
        print("  3. You have network access to the database host")
        sys.exit(1)
    finally:
        await engine.dispose()


def main_sync() -> None:
    """Synchronous entry point for the ``setup-db`` console script."""
    asyncio.run(main())


if __name__ == "__main__":
    main_sync()
