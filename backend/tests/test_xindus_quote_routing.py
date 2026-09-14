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
    for origin in (
        "https://x-indus.com", "https://www.x-indus.com",
        "https://4umachining.com", "https://www.4umachining.com",
    ):
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
        ("https://4umachining.com", "xindus", "4u"),
        ("https://www.4umachining.com", "default", "4u"),
        ("https://4UMACHINING.COM", "", "4u"),
        (None, " 4U ", "4u"),
        ("https://4umachining.com.attacker.example", "", "default"),
        ("https://not-4umachining.com", "unknown", "default"),
        ("https://x-indus.com", "4u", "xindus"),
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


@pytest.mark.parametrize(
    ("referer", "site"),
    [
        ("https://x-indus.com/online-ai-quote/", "xindus"),
        ("https://4umachining.com/online-quote/", "4u"),
    ],
)
def test_referer_routes_site_when_origin_is_absent(xindus_api, referer, site):
    with xindus_api.app.app.test_request_context(
        "/api/public/quote/calculate",
        headers={"Referer": referer},
    ):
        assert xindus_api.app._site_from_request(xindus_api.app.request, "default") == site


@pytest.mark.parametrize(
    ("origin", "site", "quote_url", "contact_url"),
    [
        ("https://x-indus.com", "xindus", "https://x-indus.com/get-a-quote/", "https://x-indus.com/contact/"),
        ("https://www.x-indus.com", "xindus", "https://x-indus.com/get-a-quote/", "https://x-indus.com/contact/"),
        ("https://4umachining.com", "4u", "https://4umachining.com/contact/", "https://4umachining.com/contact/"),
        ("https://www.4umachining.com", "4u", "https://4umachining.com/contact/", "https://4umachining.com/contact/"),
    ],
)
def test_site_cors_and_public_settings_keep_mail_private(xindus_api, origin, site, quote_url, contact_url):
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
    assert payload["site"] == site
    assert payload["settings"]["formal_quote_url"] == quote_url
    assert payload["settings"]["engineer_contact_url"] == contact_url
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
    assert settings.get_setting("quote:4u", "quote_email_enabled") == "false"
    assert settings.get_setting("quote:4u", "quote_email_recipients") == "existing@example.invalid"
    assert settings.get_setting("quote:4u", "quote_email_from_name") == "4U Machining Online Quote"
    assert settings.get_setting("quote:4u", "preview_watermark_text") == "4U MACHINING"
    for site in ("default", "mfg", "gcindus", "gcnov"):
        assert settings.get_setting(f"quote:{site}", "quote_email_enabled") == "false"
        assert settings.get_setting(f"quote:{site}", "quote_email_recipients") == "existing@example.invalid"
        assert settings.get_setting(f"quote:{site}", "quote_email_from_name") == "Existing Online Quote"
        assert settings.get_setting(f"quote:{site}", "preview_watermark_text") == "GCNOV CO., LIMITED"

    monkeypatch.setenv("QUOTE_EMAIL_ENABLED", "true")
    monkeypatch.setenv("QUOTE_EMAIL_ALLOWED_SITES", "mfg,gcnov,4u")
    assert settings._email_enabled_default("mfg") == "true"
    assert settings._email_enabled_default("gcnov") == "true"
    assert settings._email_enabled_default("4u") == "true"
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
        ("4u", "4u-existing@example.invalid"),
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
        "4u": "https://4umachining.com",
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
        else "4U Machining Online Quote <sender@example.invalid>"
        if site == "4u"
        else "Existing Online Quote <sender@example.invalid>"
    )
    session = xindus_api.sessions()
    row = session.query(xindus_api.models.QuoteEmailLog).one()
    assert (row.site, row.recipient, row.status) == (site, recipient, "sent")


@pytest.fixture()
def quote_admin(xindus_api, monkeypatch):
    import admin_app

    monkeypatch.setattr(admin_app, "SessionLocal", xindus_api.sessions)
    monkeypatch.setitem(admin_app.app.config, "SECRET_KEY", "test-only-admin-session-key")
    client = admin_app.app.test_client()
    with client.session_transaction() as session:
        session["admin_user"] = "site-config-test"
    return SimpleNamespace(app=admin_app.app, client=client)


def _admin_rows(client, site=None):
    query = {"scope": f"quote:{site}"} if site else {}
    response = client.get("/api/admin/settings", query_string=query)
    assert response.status_code == 200
    return {
        (row["scope"], row["key"]): row
        for row in response.get_json()["settings"]
    }


def _admin_save(client, site, key, value):
    response = client.put(
        "/api/admin/settings",
        json={"scope": f"quote:{site}", "key": key, "value": value},
        headers={"User-Agent": "Quote settings regression"},
    )
    assert response.status_code == 200
    assert response.get_json() == {"ok": True}


@pytest.mark.parametrize("site", ["4u", "xindus"])
def test_admin_site_changes_persist_remain_private_and_do_not_change_other_sites(
    xindus_api, quote_admin, site
):
    before = _admin_rows(quote_admin.client)
    scope = f"quote:{site}"
    assert any(row_scope == scope for row_scope, _ in before)
    changes = {
        "quote_email_recipients": f"saved-{site}@example.invalid",
        "quote_email_enabled": "true",
        "formal_quote_label": f"Ask {site} engineers",
        "formal_quote_url": f"https://{site}.example.invalid/quote/",
        "privacy_note": f"Private drawings are handled by {site} engineers.",
    }
    for key, value in changes.items():
        _admin_save(quote_admin.client, site, key, value)

    # A fresh client and session force another read and another defaults seed.
    xindus_api.sessions.remove()
    fresh_client = quote_admin.app.test_client()
    with fresh_client.session_transaction() as session:
        session["admin_user"] = "site-config-test"
    after = _admin_rows(fresh_client)
    for identity, old_row in before.items():
        if identity[0] != scope:
            assert after[identity] == old_row
    scoped_rows = _admin_rows(fresh_client, site)
    assert scoped_rows
    assert {row_scope for row_scope, _ in scoped_rows} == {scope}
    for key, value in changes.items():
        row = scoped_rows[(scope, key)]
        assert row["value"] == value
        assert row["updated_by"] == "site-config-test"

    response = xindus_api.client.get(
        "/api/public/settings", query_string={"tool": "quote", "site": site}
    )
    public = response.get_json()["settings"]
    for key in ("formal_quote_label", "formal_quote_url", "privacy_note"):
        assert public[key] == changes[key]
    assert not any(key.startswith("quote_email_") for key in public)
    assert "preview_watermark_text" not in public
    assert changes["quote_email_recipients"] not in response.get_data(as_text=True)
    assert "test-only-password" not in response.get_data(as_text=True)

    session = xindus_api.sessions()
    audits = session.query(xindus_api.models.AdminAuditLog).filter_by(
        action="update_setting", admin_username="site-config-test"
    ).all()
    assert len(audits) == len(changes)
    for audit in audits:
        key = audit.target_key.split("/", 1)[1]
        assert audit.target_key == f"{scope}/{key}"
        assert audit.old_value == before[(scope, key)]["value"]
        assert audit.new_value == changes[key]
        assert audit.client_ip == "127.0.0.1"
        assert audit.user_agent == "Quote settings regression"


def test_public_settings_apply_global_then_default_then_requested_site(
    xindus_api, quote_admin
):
    _admin_save(quote_admin.client, "default", "formal_quote_label", "Default request")
    _admin_save(quote_admin.client, "4u", "formal_quote_label", "4U request")
    session = xindus_api.sessions()
    session.add_all([
        xindus_api.models.AppSetting(
            scope=scope, key=key, value=value, value_type="string", is_public=True
        )
        for scope, key, value in [
            ("global", "formal_quote_label", "Global request"),
            ("global", "global_only_note", "Shared note"),
            ("global", "fallback_note", "Global fallback"),
            ("quote:default", "fallback_note", "Default fallback"),
        ]
    ])
    session.commit()
    xindus_api.sessions.remove()
    for site, expected_label in [("4u", "4U request"), ("default", "Default request")]:
        response = xindus_api.client.get(
            "/api/public/settings", query_string={"tool": "quote", "site": site}
        )
        assert response.status_code == 200
        public = response.get_json()["settings"]
        assert public["formal_quote_label"] == expected_label
        assert public["global_only_note"] == "Shared note"
        assert public["fallback_note"] == "Default fallback"


@pytest.mark.parametrize("site", ["4u", "xindus"])
def test_quotes_use_admin_saved_mail_settings_and_stop_when_disabled(
    xindus_api, quote_admin, monkeypatch, site
):
    recipient = f"admin-saved-{site}@example.invalid"
    sender_name = f"Saved {site} sender"
    for key, value in {
        "quote_email_recipients": recipient,
        "quote_email_enabled": "true",
        "quote_email_throttle_minutes": "0",
        "quote_email_from_name": sender_name,
    }.items():
        _admin_save(quote_admin.client, site, key, value)
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

    monkeypatch.setattr(xindus_api.notifications.smtplib, "SMTP_SSL", FakeSMTP)
    monkeypatch.setattr(xindus_api.notifications, "_find_thumbnail", lambda *args: None)

    def calculate_without_cad(payload, **kwargs):
        assert payload["site"] == payload["theme"] == site
        result = {
            "customer_name": payload["customer_name"],
            "customer_email": payload["customer_email"],
            "part": {"name": "Saved settings test"},
            "selections": {"quantity": 1},
            "currency": "USD",
            "total_estimate": {"display": "$12.00"},
        }
        xindus_api.notifications._notify_impl(
            payload=payload, result=result, inquiry_id=None, **kwargs
        )
        return result

    monkeypatch.setattr(xindus_api.app, "calculate_quote", calculate_without_cad)
    for enabled, customer in [(True, "first"), (False, "second")]:
        if not enabled:
            _admin_save(quote_admin.client, site, "quote_email_enabled", "false")
        response = xindus_api.client.post(
            "/api/public/quote/calculate",
            json={
                "theme": site,
                "customer_name": "Admin settings test customer",
                "customer_email": f"{customer}@example.invalid",
            },
        )
        assert response.status_code == 200
        assert len(sent) == 1
    assert str(sent[0]["To"]) == recipient
    assert str(sent[0]["From"]) == f"{sender_name} <sender@example.invalid>"
    assert str(sent[0]["Reply-To"]) == "first@example.invalid"
    session = xindus_api.sessions()
    rows = session.query(xindus_api.models.QuoteEmailLog).order_by(
        xindus_api.models.QuoteEmailLog.id
    ).all()
    assert [(row.site, row.status) for row in rows] == [
        (site, "sent"), (site, "site_not_allowed")
    ]
    assert rows[0].recipient == recipient
