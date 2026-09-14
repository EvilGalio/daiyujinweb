from __future__ import annotations

import importlib.util
import re
import socket
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import scoped_session, sessionmaker


@pytest.fixture()
def xindus_api(monkeypatch, tmp_path: Path):
    network_attempts = []

    def reject_network(*args, **kwargs):
        network_attempts.append(True)
        pytest.fail("A routing test attempted a real network connection")

    monkeypatch.setattr(socket, "create_connection", reject_network)
    monkeypatch.setattr(socket, "getaddrinfo", reject_network)
    monkeypatch.setattr(socket.socket, "connect", reject_network)
    monkeypatch.setattr(socket.socket, "connect_ex", reject_network)
    backend_root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(backend_root))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'routing.db'}")
    monkeypatch.setenv("QUOTE_ASYNC_ARCHIVES_ENABLED", "0")
    monkeypatch.setenv("QUOTE_EMAIL_ENABLED", "false")
    monkeypatch.setenv("QUOTE_EMAIL_ALLOWED_SITES", "")
    monkeypatch.setenv("QUOTE_EMAIL_RECIPIENTS", "existing@example.invalid")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.invalid")
    monkeypatch.setenv("SMTP_USERNAME", "sender@example.invalid")
    monkeypatch.setenv("SMTP_PASSWORD", "test-only-password")
    monkeypatch.setenv("SMTP_FROM", "sender@example.invalid")
    monkeypatch.setenv("SMTP_FROM_NAME", "Existing Online Quote")
    startup_source = (backend_root.parent / "run-api.ps1").read_text(encoding="utf-8-sig")
    startup_origins = re.findall(
        r'^\$env:ALLOWED_ORIGINS\s*=\s*"([^"\r\n]+)"\s*$',
        startup_source,
        flags=re.MULTILINE,
    )
    assert len(startup_origins) == 1
    # Simulate server-local CORS overrides without changing the tracked launcher.
    server_origins = [origin.strip() for origin in startup_origins[0].split(",")]
    for origin in ("https://x-indus.com", "https://www.x-indus.com"):
        if origin not in server_origins:
            server_origins.append(origin)
    monkeypatch.setenv("ALLOWED_ORIGINS", ",".join(server_origins))
    monkeypatch.delenv("PRECISION_TOOLS_PRODUCTION", raising=False)

    import database
    import models

    engine = create_engine(f"sqlite:///{tmp_path / 'routing.db'}")
    sessions = scoped_session(sessionmaker(bind=engine, autoflush=False))
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "SessionLocal", sessions)
    database.Base.metadata.create_all(bind=engine)

    from services import exchange_rates, quote_email_notifications, settings

    # Reload only defaults so earlier tests cannot freeze this fixture's environment.
    spec = importlib.util.spec_from_file_location(
        "xindus_settings_defaults", backend_root / "services" / "settings.py"
    )
    fresh_settings = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fresh_settings)
    monkeypatch.setattr(settings, "DEFAULTS", fresh_settings.DEFAULTS)
    monkeypatch.setattr(settings, "SessionLocal", sessions)
    monkeypatch.setattr(quote_email_notifications, "SessionLocal", sessions)
    monkeypatch.setattr(exchange_rates, "ensure_recent_rates", lambda **_: None)

    monkeypatch.setattr(quote_email_notifications.smtplib, "SMTP_SSL", reject_network)
    monkeypatch.setattr(quote_email_notifications.smtplib, "SMTP", reject_network)

    import app as app_module

    monkeypatch.setattr(app_module, "ensure_recent_rates", lambda **_: None)
    flask_app = app_module.create_app()
    yield SimpleNamespace(
        app=app_module,
        client=flask_app.test_client(),
        settings=settings,
        notifications=quote_email_notifications,
        sessions=sessions,
        models=models,
    )
    sessions.remove()
    engine.dispose()
    assert network_attempts == []


@pytest.mark.parametrize(
    ("origin", "candidate", "expected"),
    [
        ("https://x-indus.com", "mfg", "xindus"),
        ("https://www.x-indus.com", "default", "xindus"),
        ("https://X-INDUS.COM", "", "xindus"),
        (None, " XINDUS ", "xindus"),
        ("https://x-indus.com.attacker.example", "", "default"),
        ("https://not-x-indus.com", "unknown", "default"),
        ("https://unknown.example", "", "default"),
        ("https://mfg-solution.com", "xindus", "mfg"),
        ("https://gcindus.com", "xindus", "gcindus"),
        ("https://www.gcnov.com", "xindus", "gcnov"),
        ("https://gcnov.com.attacker.example", "", "default"),
        (None, "default", "default"),
    ],
)
def test_request_binds_exact_site_domains(xindus_api, origin, candidate, expected):
    headers = {"Origin": origin} if origin else {}
    with xindus_api.app.app.test_request_context(
        "/api/public/quote/calculate", headers=headers
    ):
        assert xindus_api.app._site_from_request(
            xindus_api.app.request, candidate
        ) == expected


def test_referer_routes_xindus_when_origin_is_absent(xindus_api):
    with xindus_api.app.app.test_request_context(
        "/api/public/quote/calculate",
        headers={"Referer": "https://x-indus.com/online-ai-quote/"},
    ):
        assert xindus_api.app._site_from_request(xindus_api.app.request, "default") == "xindus"


@pytest.mark.parametrize("origin", ["https://x-indus.com", "https://www.x-indus.com"])
def test_xindus_cors_and_public_settings_keep_mail_private(xindus_api, origin):
    preflight = xindus_api.client.options(
        "/api/public/quote/calculate",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["Access-Control-Allow-Origin"] == origin

    response = xindus_api.client.get(
        "/api/public/settings?tool=quote&site=mfg", headers={"Origin": origin}
    )
    payload = response.get_json()
    assert response.status_code == 200
    assert payload["site"] == "xindus"
    assert payload["settings"]["formal_quote_url"] == "https://x-indus.com/get-a-quote/"
    assert payload["settings"]["engineer_contact_url"] == "https://x-indus.com/contact/"
    assert not any(key.startswith("quote_email_") for key in payload["settings"])
    assert "johnson@x-indus.com" not in response.get_data(as_text=True)


def test_spoofed_domain_does_not_receive_cors_permission(xindus_api):
    response = xindus_api.client.options(
        "/api/public/quote/calculate",
        headers={
            "Origin": "https://x-indus.com.attacker.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "Access-Control-Allow-Origin" not in response.headers


def test_xindus_mail_defaults_preserve_existing_sites_and_environment(xindus_api, monkeypatch):
    settings = xindus_api.settings
    assert settings.get_setting("quote:xindus", "quote_email_recipients") == "johnson@x-indus.com"
    assert settings.get_setting("quote:xindus", "quote_email_enabled") == "true"
    assert settings.get_setting("quote:xindus", "quote_email_from_name") == "X IND MFG Online Quote"
    assert settings.get_setting("quote:xindus", "preview_watermark_text") == "X IND MFG"
    for site in ("default", "mfg", "gcindus", "gcnov"):
        assert settings.get_setting(f"quote:{site}", "quote_email_enabled") == "false"
        assert settings.get_setting(f"quote:{site}", "quote_email_recipients") == "existing@example.invalid"
        assert settings.get_setting(f"quote:{site}", "quote_email_from_name") == "Existing Online Quote"
        assert settings.get_setting(f"quote:{site}", "preview_watermark_text") == "GCNOV CO., LIMITED"

    monkeypatch.setenv("QUOTE_EMAIL_ENABLED", "true")
    monkeypatch.setenv("QUOTE_EMAIL_ALLOWED_SITES", "mfg,gcnov")
    assert settings._email_enabled_default("mfg") == "true"
    assert settings._email_enabled_default("gcnov") == "true"
    assert settings._email_enabled_default("default") == "false"


@pytest.mark.parametrize(
    ("site", "quote_url"),
    [
        ("default", "https://mfg-solution.com/request-quote/"),
        ("mfg", "https://mfg-solution.com/request-quote/"),
        ("gcindus", "https://gcindus.com/get-a-quotation/"),
        ("gcnov", "https://gcnov.com/contact/"),
    ],
)
def test_existing_public_site_urls_are_preserved(xindus_api, site, quote_url):
    result = xindus_api.settings.get_public_settings(tool="quote", site=site)
    assert result["formal_quote_url"] == quote_url
    assert result["engineer_contact_url"] == quote_url


def test_api_starts_with_existing_cors_configuration(xindus_api, monkeypatch):
    response = xindus_api.client.get("/api/health")
    assert response.status_code == 200
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    assert xindus_api.app._cors_origins() == "*"


@pytest.mark.parametrize(
    ("site", "recipient"),
    [
        ("xindus", "johnson@x-indus.com"),
        ("mfg", "mfg-existing@example.invalid"),
        ("gcindus", "gcindus-existing@example.invalid"),
        ("gcnov", "gcnov-existing@example.invalid"),
        ("default", "default-existing@example.invalid"),
    ],
)
def test_calculate_route_sends_only_to_its_site_recipient(xindus_api, monkeypatch, site, recipient):
    settings = xindus_api.settings
    notifications = xindus_api.notifications
    if site != "xindus":
        settings.update_setting(f"quote:{site}", "quote_email_enabled", "true")
        settings.update_setting(f"quote:{site}", "quote_email_recipients", recipient)
    settings.update_setting(f"quote:{site}", "quote_email_throttle_minutes", "0")
    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            assert host == "smtp.example.invalid"

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def login(self, username, password):
            assert username == "sender@example.invalid"
            assert password == "test-only-password"

        def send_message(self, message):
            sent.append(message)

    monkeypatch.setattr(notifications.smtplib, "SMTP_SSL", FakeSMTP)
    monkeypatch.setattr(notifications, "_find_thumbnail", lambda *args: None)

    def calculate_without_cad(payload, **kwargs):
        assert payload["site"] == payload["theme"] == site
        result = {
            "customer_name": payload["customer_name"],
            "customer_email": payload["customer_email"],
            "part": {"name": "Routing test"},
            "selections": {"quantity": 1},
            "currency": "USD",
            "total_estimate": {"display": "$12.00"},
        }
        notifications._notify_impl(payload=payload, result=result, inquiry_id=None, **kwargs)
        return result

    monkeypatch.setattr(xindus_api.app, "calculate_quote", calculate_without_cad)
    origin = {
        "xindus": "https://x-indus.com",
        "mfg": "https://mfg-solution.com",
        "gcindus": "https://gcindus.com",
        "gcnov": "https://gcnov.com",
    }.get(site)
    headers = {"Origin": origin} if origin else {}
    response = xindus_api.client.post(
        "/api/public/quote/calculate",
        json={
            "site": "mfg" if site == "xindus" else "xindus" if origin else "default",
            "customer_name": "Routing test customer",
            "customer_email": "customer@example.invalid",
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert len(sent) == 1
    assert str(sent[0]["To"]) == recipient
    assert str(sent[0]["Reply-To"]) == "customer@example.invalid"
    assert str(sent[0]["From"]) == (
        "X IND MFG Online Quote <sender@example.invalid>"
        if site == "xindus"
        else "Existing Online Quote <sender@example.invalid>"
    )
    session = xindus_api.sessions()
    row = session.query(xindus_api.models.QuoteEmailLog).one()
    assert (row.site, row.recipient, row.status) == (site, recipient, "sent")
