import time
import uuid
from collections.abc import Awaitable, Callable

import structlog
from fastapi import Depends, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from prometheus_fastapi_instrumentator.routing import get_route_name
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.logging_setup import configure_logging
from app.routers import admin, auth, catalog, household, institutions, stats, transactions

API_PREFIX = "/api/v1"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# Browsers can't send this header cross-site without a CORS preflight, so requiring it on
# every write blocks CSRF on top of the SameSite=Lax session cookie.
CSRF_HEADER = "x-requested-with"

log = structlog.get_logger("app.access")


def route_template(request: Request) -> str:
    """The matched route's full template (e.g. /api/v1/transactions/{transaction_id}).

    Same resolver the /metrics handler label uses, so logs and metrics agree and raw ids
    never reach the logs.
    """
    return get_route_name(request, should_include_root_path=False) or "unmatched"


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings)
    app = FastAPI(
        title="Expense Tracker API",
        version="0.1.0",
        description="Household expense tracker. All routes under /api/v1 need a session cookie, "
        "except login, invite accept and password reset.",
    )

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)
        started = time.perf_counter()
        if (
            request.method in UNSAFE_METHODS
            and request.url.path.startswith(API_PREFIX)
            and not request.headers.get(CSRF_HEADER)
        ):
            response: Response = JSONResponse(
                {"detail": "Missing X-Requested-With header"}, status_code=403
            )
        else:
            response = await call_next(request)
        path = route_template(request)
        if path not in {"/healthz", "/readyz", "/metrics"}:
            log.info(
                "request",
                method=request.method,
                path=path,
                status=response.status_code,
                duration_ms=round((time.perf_counter() - started) * 1000, 1),
            )
        response.headers["x-request-id"] = request_id
        return response

    @app.get("/healthz", tags=["health"])
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz", tags=["health"])
    def readyz(db: Session = Depends(get_db)) -> Response:
        try:
            db.execute(text("SELECT 1"))
        except Exception:
            log.warning("readiness check failed: database unreachable")
            return JSONResponse({"status": "unavailable"}, status_code=503)
        return JSONResponse({"status": "ok"})

    for module in (auth, household, catalog, institutions, transactions, stats, admin):
        app.include_router(module.router, prefix=API_PREFIX)

    Instrumentator(
        excluded_handlers=["/healthz", "/readyz", "/metrics"],
        should_group_status_codes=True,
    ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
    return app


app = create_app()
