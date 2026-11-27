import hashlib

import pytest
from fastapi.testclient import TestClient

from bioharness_web.app import SESSION_COOKIE, create_app
from bioharness_web.cli import ToolError
from bioharness_web.sources import Sources

from conftest import TOKEN

AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client(settings, fake_runner):
    return TestClient(create_app(settings, sources=Sources(settings, fake_runner)))


# ---- authentication ----------------------------------------------------------
@pytest.mark.parametrize("path", [
    "/api/meta",
    "/api/workspaces/pilot/views/tree",
    "/api/workspaces/pilot/stream",
    "/api/workspaces/pilot/evidence-preview?request_id=r&submission_index=1&evidence_id=e1&sha256=" + "a" * 64,
])
def test_every_data_route_requires_authentication(client, fake_runner, path):
    assert client.get(path).status_code == 401
    assert client.get(path, headers={"Authorization": "Bearer wrong-token-000000"}).status_code == 401
    assert fake_runner.calls == []


def test_health_is_public_and_says_nothing_else(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_sign_in_sets_an_http_only_cookie_that_is_not_the_token(client, fake_runner):
    assert client.post("/api/session", json={"token": "wrong-token-000000"}).status_code == 401
    response = client.post("/api/session", json={"token": TOKEN})
    assert response.status_code == 204
    header = response.headers["set-cookie"]
    assert "HttpOnly" in header and "SameSite=strict" in header
    assert TOKEN not in header
    assert client.cookies.get(SESSION_COOKIE)
    assert client.get("/api/meta").status_code == 200


def test_meta_lists_workspace_ids_but_no_paths(client, workspace_dir):
    body = client.get("/api/meta", headers=AUTH)
    assert body.json()["workspaces"] == ["pilot"]
    assert body.json()["service"] == "test-service"
    assert str(workspace_dir) not in body.text


def test_meta_reports_whether_each_configured_command_exists(settings, fake_runner):
    import dataclasses, sys
    configured = dataclasses.replace(settings, core_cli=sys.executable,
                                     governance_cli="/nonexistent/bioharness-governance")
    body = TestClient(create_app(configured, sources=Sources(configured, fake_runner))).get(
        "/api/meta", headers=AUTH).json()
    assert body["tools"]["core"]["found"] is True
    assert body["tools"]["project-governance"] == {"command": "bioharness-governance", "found": False}


def test_the_session_cookie_is_secure_over_https(settings, fake_runner):
    https = TestClient(create_app(settings, sources=Sources(settings, fake_runner)),
                       base_url="https://workspace.example")
    header = https.post("/api/session", json={"token": TOKEN}).headers["set-cookie"]
    assert "Secure" in header


def test_api_answers_are_never_cached(client, fake_runner):
    fake_runner.answers["tree"] = {"ok": True, "nodes": []}
    response = client.get("/api/workspaces/pilot/views/tree", headers=AUTH)
    assert response.headers["cache-control"] == "no-store"


def test_nothing_under_api_is_served_from_the_static_directory(settings, fake_runner, tmp_path):
    static = tmp_path / "static"
    (static / "api" / "meta").mkdir(parents=True)
    (static / "api" / "meta" / "index.html").write_text("shadow")
    (static / "index.html").write_text("frontend")
    app = TestClient(create_app(settings, sources=Sources(settings, fake_runner), static_dir=static))
    assert app.get("/").text == "frontend"
    for path in ("/api/meta/", "/api/meta/index.html", "/api/anything"):
        response = app.get(path)
        assert response.status_code == 404 and "shadow" not in response.text


# ---- change notifications ----------------------------------------------------
def watches_of(client, monkeypatch, url):
    """The views the stream route asks version_stream to watch."""
    from bioharness_web import api as api_module
    seen = {}

    def fake_version_stream(_sources, workspace_id, watches, interval):
        seen.update(workspace=workspace_id, watches=list(watches), interval=interval)

        async def nothing():
            return
            yield  # pragma: no cover

        return nothing()

    monkeypatch.setattr(api_module, "version_stream", fake_version_stream)
    assert client.get(url, headers=AUTH).status_code == 200
    return seen


def test_stream_always_watches_open_requests_and_the_tree(client, monkeypatch):
    seen = watches_of(client, monkeypatch, "/api/workspaces/pilot/stream?project_id=p")
    assert seen["watches"] == [("open", {}), ("tree", {"project_id": "p"})]
    assert seen["workspace"] == "pilot" and seen["interval"] == 1.0


def test_stream_watches_the_selected_request(client, monkeypatch):
    seen = watches_of(client, monkeypatch, "/api/workspaces/pilot/stream?request_id=r1")
    assert seen["watches"] == [("open", {}), ("tree", {}), ("now", {"request_id": "r1"})]


def test_stream_rejects_a_malformed_request_id_and_an_unknown_workspace(client):
    assert client.get("/api/workspaces/pilot/stream?request_id=", headers=AUTH).status_code == 422
    assert client.get("/api/workspaces/other/stream", headers=AUTH).status_code == 404


# ---- views -------------------------------------------------------------------
def test_view_returns_a_snapshot(client, fake_runner):
    fake_runner.answers["tree"] = {"ok": True, "project_id": "p", "nodes": [], "view_sha256": "v"}
    body = client.get("/api/workspaces/pilot/views/tree?project_id=p", headers=AUTH).json()
    assert body["view"] == "tree" and body["selector"] == {"project_id": "p"}
    assert body["data"]["project_id"] == "p"


def test_owner_refusal_is_a_snapshot_not_an_http_error(client, fake_runner):
    fake_runner.answers["tree"] = {"ok": False, "error": "project_id must be an existing root scope"}
    response = client.get("/api/workspaces/pilot/views/tree?project_id=zz", headers=AUTH)
    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert response.json()["error"]["origin"] == "project-governance"


def test_every_selector_parameter_reaches_the_owner(client, fake_runner):
    fake_runner.answers["routes"] = {"ok": True, "attempts": []}
    client.get("/api/workspaces/pilot/views/routes", headers=AUTH, params={
        "scope_id": "s", "offset": 100, "limit": 50,
        "include_descendants": "true", "include_related": "true"})
    argv, _ = fake_runner.calls[0]
    assert argv[3:] == ["--include-descendants", "--include-related", "--limit=50",
                        "--offset=100", "--scope-id=s"]


def test_selector_and_workspace_errors(client, fake_runner):
    assert client.get("/api/workspaces/pilot/views/now", headers=AUTH).status_code == 422
    assert client.get("/api/workspaces/pilot/views/unknown", headers=AUTH).status_code == 422
    assert client.get("/api/workspaces/other/views/tree", headers=AUTH).status_code == 404
    assert client.get("/api/workspaces/pilot/views/routes?scope_id=s&limit=x",
                      headers=AUTH).status_code == 422
    assert fake_runner.calls == []


def test_unreachable_tool_is_reported_as_a_gateway_error(client, fake_runner):
    fake_runner.answers["tree"] = ToolError("TOOL_UNAVAILABLE", "bioharness-governance could not be started")
    response = client.get("/api/workspaces/pilot/views/tree", headers=AUTH)
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "TOOL_UNAVAILABLE"
    fake_runner.answers["tree"] = ToolError("TOOL_TIMEOUT", "slow")
    assert client.get("/api/workspaces/pilot/views/tree?project_id=p", headers=AUTH).status_code == 504


def test_there_is_no_write_route(client):
    for method in ("post", "put", "patch", "delete"):
        response = getattr(client, method)("/api/workspaces/pilot/views/tree", headers=AUTH)
        assert response.status_code == 405


# ---- evidence preview --------------------------------------------------------
PREVIEW = "/api/workspaces/pilot/evidence-preview"


def anchor(sha):
    return {"request_id": "r1", "submission_index": 1, "evidence_id": "e1", "sha256": sha}


def test_preview_resolves_the_anchor_through_governance(client, fake_runner, workspace_dir):
    data = b"gene\tcount\nA\t3\n"
    (workspace_dir / "table.tsv").write_bytes(data)
    sha = hashlib.sha256(data).hexdigest()
    fake_runner.answers["evidence"] = {
        "ok": True, "recorded_reference": "MATCH", "snapshot_integrity": "MATCH",
        "note": "Recorded content identity only",
        "evidence": {"id": "e1", "kind": "file", "sha256": sha, "bytes": len(data),
                     "source": f"{workspace_dir}/table.tsv"}}
    response = client.get(PREVIEW, params=anchor(sha), headers=AUTH)
    body = response.json()
    assert body["ok"] is True and body["snapshot_integrity"] == "MATCH"
    assert body["preview"]["content"] == data.decode()
    assert body["preview"]["current_file_identity"] == "MATCHES_RECORD"
    assert str(workspace_dir) not in response.text
    argv, _ = fake_runner.calls[0]
    assert argv[2] == "evidence" and f"--sha256={sha}" in argv


def test_preview_uses_the_configured_size_bound(settings, fake_runner, workspace_dir):
    import dataclasses
    data = b"A" * 6000 + b"B" * 6000
    (workspace_dir / "long.txt").write_bytes(data)
    sha = hashlib.sha256(data).hexdigest()
    fake_runner.answers["evidence"] = {"ok": True, "evidence": {
        "id": "e1", "kind": "file", "sha256": sha, "bytes": len(data),
        "source": f"{workspace_dir}/long.txt"}}
    small = dataclasses.replace(settings, evidence_preview_max_bytes=4096)
    body = TestClient(create_app(small, sources=Sources(small, fake_runner))).get(
        PREVIEW, params=anchor(sha), headers=AUTH).json()
    assert body["preview"]["truncated"] is True
    assert body["preview"]["content"].count("A") == 2048 and body["preview"]["content"].count("B") == 2048


def test_preview_of_an_unrecorded_anchor_opens_nothing(client, fake_runner, workspace_dir):
    (workspace_dir / "table.tsv").write_bytes(b"x")
    fake_runner.answers["evidence"] = {
        "ok": False, "error": "Evidence reference does not match the recorded version"}
    body = client.get(PREVIEW, params=anchor("b" * 64), headers=AUTH).json()
    assert body["ok"] is False and "preview" not in body
    assert body["error"]["message"] == "Evidence reference does not match the recorded version"


def test_preview_has_no_path_parameter(client, fake_runner, workspace_dir):
    fake_runner.answers["evidence"] = {"ok": False, "error": "Unknown scoped request in this workspace"}
    body = client.get(PREVIEW, params={**anchor("a" * 64), "path": "/etc/passwd"},
                      headers=AUTH).json()
    # an extra parameter is ignored: only the recorded anchor is resolved
    assert body["ok"] is False and "preview" not in body
    assert all("/etc/passwd" not in " ".join(argv) for argv, _ in fake_runner.calls)
    assert client.get(PREVIEW, params={"request_id": "r1"}, headers=AUTH).status_code == 422


# ---- C1 / C2: CSP security headers and SPA deep-link fallback ----------------
def test_spa_deep_links_return_index_with_strict_csp_and_no_cache(settings, fake_runner, tmp_path):
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "assets" / "app.js").write_text("console.log('ok');", encoding="utf-8")
    (static / "index.html").write_text(
        "<!doctype html><html><head><script>window.__boot=1;</script></head><body>ok</body></html>",
        encoding="utf-8",
    )
    app = TestClient(create_app(settings, sources=Sources(settings, fake_runner), static_dir=static))

    for route in ("/", "/login", "/c/new", "/c/conv-42"):
        res = app.get(route)
        assert res.status_code == 200
        assert "window.__boot=1;" in res.text
        assert res.headers["cache-control"] == "no-cache"
        csp = res.headers["content-security-policy"]
        assert "default-src 'self'" in csp
        assert "connect-src 'self'" in csp
        assert "frame-ancestors 'self'" in csp
        assert "script-src 'self' 'sha256-" in csp
        assert "'unsafe-inline'" not in csp.split("script-src", 1)[1].split(";", 1)[0]
        assert res.headers["x-content-type-options"] == "nosniff"
        assert res.headers["x-frame-options"] == "SAMEORIGIN"

    asset = app.get("/assets/app.js")
    assert asset.status_code == 200 and "console.log('ok');" in asset.text


def test_missing_assets_exact_api_and_symlink_escape_return_404(settings, fake_runner, tmp_path):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("frontend", encoding="utf-8")
    secret = tmp_path / "secret.txt"
    secret.write_text("do-not-leak", encoding="utf-8")
    (static / "escape.txt").symlink_to(secret)
    app = TestClient(create_app(settings, sources=Sources(settings, fake_runner), static_dir=static))

    for missing in ("/api", "/api/nonexistent", "/assets/missing.js", "/missing.css", "/escape.txt"):
        res = app.get(missing)
        assert res.status_code == 404
        assert "do-not-leak" not in res.text
        assert "frontend" not in res.text
