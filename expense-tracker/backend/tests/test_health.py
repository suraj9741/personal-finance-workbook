from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.db import get_db
from app.main import app


def test_healthz_and_readyz() -> None:
    client = TestClient(app)
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/readyz").status_code == 200


def test_readyz_503_when_db_down() -> None:
    class Broken:
        def execute(self, *_: object) -> None:
            raise OperationalError("SELECT 1", {}, Exception("down"))

    app.dependency_overrides[get_db] = lambda: Broken()
    try:
        assert TestClient(app).get("/readyz").status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_metrics_and_docs() -> None:
    client = TestClient(app)
    client.get("/healthz")
    metrics = client.get("/metrics")
    assert metrics.status_code == 200
    assert "http_requests_total" in metrics.text or "http_request" in metrics.text
    assert client.get("/docs").status_code == 200
    assert "/api/v1/transactions" in client.get("/openapi.json").json()["paths"]
    assert 'logins_total{result="rate_limited"}' in metrics.text


def test_route_template_uses_full_path_without_ids() -> None:
    from starlette.requests import Request

    from app.main import route_template

    def req(path: str, method: str = "GET") -> Request:
        scope = {"type": "http", "method": method, "path": path, "headers": [], "app": app}
        return Request(scope)

    assert route_template(req("/api/v1/auth/me")) == "/api/v1/auth/me"
    tx = "/api/v1/transactions/0b7c6f1e-0000-4000-8000-000000000000"
    assert route_template(req(tx)) == "/api/v1/transactions/{transaction_id}"
    assert route_template(req("/docs")) == "/docs"
    assert route_template(req("/nope")) == "unmatched"
