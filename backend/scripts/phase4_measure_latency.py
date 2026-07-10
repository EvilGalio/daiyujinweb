"""Measure repeatable HTTP latency evidence without storing response bodies."""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import math
import socket
import ssl
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(percentile * len(ordered)))
    return round(ordered[rank - 1], 2)


def _summary(values: list[float]) -> dict[str, float | None]:
    return {
        "p50": _percentile(values, 0.50),
        "p95": _percentile(values, 0.95),
        "min": round(min(values), 2) if values else None,
        "max": round(max(values), 2) if values else None,
    }


@dataclass(frozen=True)
class Target:
    scheme: str
    hostname: str
    port: int
    path: str


def _target(url: str) -> Target:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("URL must be absolute HTTP or HTTPS")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    return Target(parsed.scheme, parsed.hostname, port, path)


class ProbeSession:
    def __init__(
        self,
        target: Target,
        timeout_seconds: float,
        ssl_context: ssl.SSLContext | None,
    ) -> None:
        self.target = target
        self.timeout_seconds = timeout_seconds
        self.ssl_context = ssl_context
        self.connection: http.client.HTTPConnection | None = None

    def close(self) -> None:
        if self.connection is not None:
            self.connection.close()
            self.connection = None

    def _new_connection(self) -> http.client.HTTPConnection:
        if self.target.scheme == "https":
            return http.client.HTTPSConnection(
                self.target.hostname,
                self.target.port,
                timeout=self.timeout_seconds,
                context=self.ssl_context or ssl.create_default_context(),
            )
        return http.client.HTTPConnection(
            self.target.hostname,
            self.target.port,
            timeout=self.timeout_seconds,
        )

    def sample(self) -> dict[str, Any]:
        started = time.perf_counter()
        connection_reused = self.connection is not None and self.connection.sock is not None
        dns_ms = 0.0
        connect_tls_ms = 0.0

        if not connection_reused:
            self.close()
            dns_started = time.perf_counter()
            socket.getaddrinfo(
                self.target.hostname,
                self.target.port,
                type=socket.SOCK_STREAM,
            )
            dns_ms = (time.perf_counter() - dns_started) * 1000
            self.connection = self._new_connection()
            connect_started = time.perf_counter()
            self.connection.connect()
            connect_tls_ms = (time.perf_counter() - connect_started) * 1000

        if self.connection is None:
            raise RuntimeError("HTTP connection was not created")

        request_started = time.perf_counter()
        self.connection.request(
            "GET",
            self.target.path,
            headers={
                "Accept": "application/json, text/plain;q=0.9, */*;q=0.1",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "User-Agent": "Daiyujin-Phase4-Latency-Probe/1.0",
            },
        )
        response = self.connection.getresponse()
        headers_ms = (time.perf_counter() - request_started) * 1000
        body_started = time.perf_counter()
        body = response.read()
        body_read_ms = (time.perf_counter() - body_started) * 1000
        total_ms = (time.perf_counter() - started) * 1000
        return {
            "ok": 200 <= response.status < 400,
            "status": response.status,
            "connection_reused": connection_reused,
            "dns_ms": round(dns_ms, 2),
            "connect_tls_ms": round(connect_tls_ms, 2),
            "response_headers_ms": round(headers_ms, 2),
            "body_read_ms": round(body_read_ms, 2),
            "total_ms": round(total_ms, 2),
            "body_size_bytes": len(body),
            "body_sha256": hashlib.sha256(body).hexdigest(),
        }

def _safe_sample(session: ProbeSession) -> dict[str, Any]:
    try:
        return session.sample()
    except Exception as exc:
        session.close()
        return {
            "ok": False,
            "status": None,
            "error_type": type(exc).__name__,
            "error_message": str(exc),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--location", required=True)
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--warmups", type=int, default=2)
    parser.add_argument("--timeout-seconds", type=float, default=20.0)
    parser.add_argument("--interval-seconds", type=float, default=0.25)
    parser.add_argument("--connection-mode", choices=("cold", "reuse"), default="cold")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    if args.samples < 1:
        raise ValueError("samples must be at least 1")
    target = _target(args.url)
    ssl_context = ssl.create_default_context() if target.scheme == "https" else None
    shared_session = ProbeSession(target, args.timeout_seconds, ssl_context)
    for _ in range(max(args.warmups, 0)):
        warmup_session = (
            shared_session
            if args.connection_mode == "reuse"
            else ProbeSession(target, args.timeout_seconds, ssl_context)
        )
        _safe_sample(warmup_session)
        if args.connection_mode == "cold":
            warmup_session.close()

    samples: list[dict[str, Any]] = []
    for index in range(args.samples):
        sample_session = (
            shared_session
            if args.connection_mode == "reuse"
            else ProbeSession(target, args.timeout_seconds, ssl_context)
        )
        samples.append(_safe_sample(sample_session))
        if args.connection_mode == "cold":
            sample_session.close()
        if index + 1 < args.samples:
            time.sleep(max(args.interval_seconds, 0.0))
    shared_session.close()

    successful = [item for item in samples if item.get("ok")]
    report = {
        "report_type": "http_latency",
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "location_label": args.location,
        "url": args.url,
        "connection_mode": args.connection_mode,
        "sample_count": len(samples),
        "success_count": len(successful),
        "error_count": len(samples) - len(successful),
        "success_rate": round(len(successful) / len(samples), 4),
        "connection_reused_count": sum(
            1 for item in successful if item.get("connection_reused")
        ),
        "metrics_ms": {
            "dns": _summary([float(item["dns_ms"]) for item in successful]),
            "connect_tls": _summary([float(item["connect_tls_ms"]) for item in successful]),
            "response_headers": _summary(
                [float(item["response_headers_ms"]) for item in successful]
            ),
            "body_read": _summary([float(item["body_read_ms"]) for item in successful]),
            "total": _summary([float(item["total_ms"]) for item in successful]),
        },
        "status_counts": {
            str(status): sum(1 for item in samples if item.get("status") == status)
            for status in sorted(
                {item.get("status") for item in samples if item.get("status") is not None}
            )
        },
        "samples": samples,
    }
    args.output.resolve().parent.mkdir(parents=True, exist_ok=True)
    args.output.resolve().write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Latency report written: {args.output.resolve()}")
    print(
        f"Success: {len(successful)}/{len(samples)}; "
        f"total p95: {report['metrics_ms']['total']['p95']} ms"
    )
    return 0 if successful else 1


if __name__ == "__main__":
    raise SystemExit(main())
