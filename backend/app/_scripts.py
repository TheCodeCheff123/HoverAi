"""Project entry-point scripts.

Registered in pyproject.toml [project.scripts] so they are available as
console commands inside the .venv:

  uv run hover       — production server (no reload, info-level logging)
  uv run hover-dev   — development server (hot reload, debug logging)
"""

import uvicorn


def run() -> None:
    """Start the production uvicorn server.

    Binds to all interfaces on port 8000. Hot reload and debug logging
    are disabled. Use this for staging and production deployments.
    """
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info",
    )


def run_dev() -> None:
    """Start the development uvicorn server with hot reload and debug logging.

    Watches all Python files under the current directory and reloads on
    change. Enables debug-level logging so SQL queries and internal events
    are visible. Do not use in production.
    """
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="debug",
    )
