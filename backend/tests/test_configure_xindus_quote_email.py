from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path

import pytest


RECIPIENT_KEY = "quote_email_recipients"
ENABLED_KEY = "quote_email_enabled"
RECIPIENT = "johnson@x-indus.com"


@pytest.fixture()
def configurator(monkeypatch):
    script = Path(__file__).resolve().parents[1] / "scripts" / "configure_xindus_quote_email.py"
    spec = importlib.util.spec_from_file_location("configure_xindus_quote_email_test", script)
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def database(tmp_path):
    path = tmp_path / "quote settings.db"
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE app_settings (
                id INTEGER PRIMARY KEY,
                scope VARCHAR(80) NOT NULL,
                key VARCHAR(120) NOT NULL,
                value TEXT NOT NULL,
                value_type VARCHAR(20) NOT NULL,
                is_public BOOLEAN,
                description VARCHAR(255),
                updated_by VARCHAR(80),
                created_at DATETIME,
                updated_at DATETIME
            );
            CREATE TABLE admin_audit_logs (
                id INTEGER PRIMARY KEY,
                admin_username VARCHAR(80),
                action VARCHAR(80) NOT NULL,
                target_type VARCHAR(80),
                target_key VARCHAR(180),
                old_value TEXT,
                new_value TEXT,
                client_ip VARCHAR(80),
                user_agent VARCHAR(255),
                created_at DATETIME
            );
            """
        )
        for site in ("default", "mfg", "gcindus", "gcnov"):
            _insert(connection, f"quote:{site}", RECIPIENT_KEY, f"{site}@example.invalid")
            _insert(connection, f"quote:{site}", ENABLED_KEY, "false", "bool")
        _insert(connection, "quote:xindus", "quote_email_smtp_password", "private-test-sentinel")
        _insert(connection, "quote:xindus", "quote_email_from_address", "sender@example.invalid")
        _insert(connection, "global", RECIPIENT_KEY, "global@example.invalid")
    return path


def _insert(connection, scope, key, value, value_type="string", is_public=0):
    connection.execute(
        "INSERT INTO app_settings "
        "(scope, key, value, value_type, is_public, description, updated_by, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (scope, key, value, value_type, is_public, "Preserve this description", "original-admin", "2026-09-01", "2026-09-01"),
    )


def _snapshot(path):
    with sqlite3.connect(path) as connection:
        return {
            table: connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
            for table in ("app_settings", "admin_audit_logs")
        }


def _other_settings(path):
    with sqlite3.connect(path) as connection:
        return connection.execute(
            "SELECT * FROM app_settings WHERE NOT "
            "(scope = 'quote:xindus' AND key IN (?, ?)) ORDER BY id",
            (RECIPIENT_KEY, ENABLED_KEY),
        ).fetchall()


def _target_settings(path):
    with sqlite3.connect(path) as connection:
        return dict(
            (row[0], row[1:])
            for row in connection.execute(
                "SELECT key, value, value_type, is_public FROM app_settings "
                "WHERE scope = 'quote:xindus' AND key IN (?, ?)",
                (RECIPIENT_KEY, ENABLED_KEY),
            )
        )


def _audit_values(path):
    with sqlite3.connect(path) as connection:
        return {
            row[0]: row[1:]
            for row in connection.execute(
                "SELECT target_key, old_value, new_value FROM admin_audit_logs"
            )
        }


@pytest.mark.parametrize("apply", [False, True])
def test_missing_database_is_rejected_without_creating_file(configurator, tmp_path, apply):
    missing = tmp_path / "missing.db"
    with pytest.raises((FileNotFoundError, ValueError, sqlite3.Error)):
        configurator.configure(missing, apply=apply)
    assert not missing.exists()


@pytest.mark.parametrize("existing", [False, True])
def test_dry_run_does_not_write_settings_or_audits(configurator, database, existing):
    if existing:
        with sqlite3.connect(database) as connection:
            _insert(connection, "quote:xindus", RECIPIENT_KEY, "old@example.invalid")
            _insert(connection, "quote:xindus", ENABLED_KEY, "false", "bool")
    before = _snapshot(database)
    original_bytes = database.read_bytes()
    result = configurator.configure(database, apply=False)
    assert isinstance(result, dict)
    assert "private-test-sentinel" not in str(result)
    assert _snapshot(database) == before
    assert database.read_bytes() == original_bytes


@pytest.mark.parametrize("existing", [False, True])
def test_apply_sets_only_xindus_and_audits_each_changed_value(configurator, database, existing):
    if existing:
        with sqlite3.connect(database) as connection:
            _insert(connection, "quote:xindus", RECIPIENT_KEY, "old@example.invalid")
            _insert(connection, "quote:xindus", ENABLED_KEY, "false", "bool")
    unrelated = _other_settings(database)
    result = configurator.configure(database, apply=True)
    assert isinstance(result, dict)
    assert "private-test-sentinel" not in str(result)
    assert _target_settings(database) == {
        RECIPIENT_KEY: (RECIPIENT, "string", 0),
        ENABLED_KEY: ("true", "bool", 0),
    }
    assert _other_settings(database) == unrelated
    assert _audit_values(database) == {
        f"quote:xindus/{RECIPIENT_KEY}": ("old@example.invalid" if existing else None, RECIPIENT),
        f"quote:xindus/{ENABLED_KEY}": ("false" if existing else None, "true"),
    }
    after_first_apply = _snapshot(database)
    configurator.configure(database, apply=True)
    assert _snapshot(database) == after_first_apply


def test_apply_repairs_type_and_privacy_even_when_values_match(configurator, database):
    with sqlite3.connect(database) as connection:
        _insert(connection, "quote:xindus", RECIPIENT_KEY, RECIPIENT, "bool", 1)
        _insert(connection, "quote:xindus", ENABLED_KEY, "true", "string", 1)
    configurator.configure(database, apply=True)
    assert _target_settings(database) == {
        RECIPIENT_KEY: (RECIPIENT, "string", 0),
        ENABLED_KEY: ("true", "bool", 0),
    }
    with sqlite3.connect(database) as connection:
        rows = connection.execute(
            "SELECT description FROM app_settings WHERE scope = 'quote:xindus' "
            "AND key IN (?, ?)", (RECIPIENT_KEY, ENABLED_KEY)
        ).fetchall()
    assert rows == [("Preserve this description",), ("Preserve this description",)]
    after_first_apply = _snapshot(database)
    configurator.configure(database, apply=True)
    assert _snapshot(database) == after_first_apply


@pytest.mark.parametrize("apply", [False, True])
@pytest.mark.parametrize("duplicate_key", [RECIPIENT_KEY, ENABLED_KEY])
def test_duplicate_target_rows_are_rejected_without_changes(configurator, database, apply, duplicate_key):
    with sqlite3.connect(database) as connection:
        _insert(connection, "quote:xindus", RECIPIENT_KEY, "old@example.invalid")
        _insert(connection, "quote:xindus", ENABLED_KEY, "false", "bool")
        _insert(connection, "quote:xindus", duplicate_key, "duplicate")
    before = _snapshot(database)
    with pytest.raises((ValueError, RuntimeError)):
        configurator.configure(database, apply=apply)
    assert _snapshot(database) == before


def test_failed_audit_rolls_back_all_setting_changes(configurator, database):
    with sqlite3.connect(database) as connection:
        _insert(connection, "quote:xindus", RECIPIENT_KEY, "old@example.invalid")
        _insert(connection, "quote:xindus", ENABLED_KEY, "false", "bool")
        connection.executescript(
            """
            CREATE TRIGGER reject_second_audit
            BEFORE INSERT ON admin_audit_logs
            WHEN (SELECT COUNT(*) FROM admin_audit_logs) > 0
            BEGIN
                SELECT RAISE(ABORT, 'Test audit write failure');
            END;
            """
        )
    before = _snapshot(database)
    with pytest.raises(sqlite3.DatabaseError):
        configurator.configure(database, apply=True)
    assert _snapshot(database) == before
