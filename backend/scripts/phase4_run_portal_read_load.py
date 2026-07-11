"""Run a bounded, read-only Order Portal workload against a loopback API."""
from __future__ import annotations

import argparse
import json
import math
import os
import time
from collections import Counter
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen


CONFIRMATION = "RUN_PORTAL_READ_LOAD"
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def _percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * quantile) - 1))
    return round(ordered[index], 3)


def _json_request(
    url: str,
    *,
    method: str = "GET",
    token: str = "",
    payload: dict[str, Any] | None = None,
    timeout_seconds: float = 10.0,
) -> tuple[int, dict[str, Any]]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Accept": "application/json", "User-Agent": "dyj-phase4-read-load/1"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, data=body, headers=headers, method=method)
    with urlopen(request, timeout=timeout_seconds) as response:
        raw = response.read()
        parsed = json.loads(raw.decode("utf-8")) if raw else {}
        if not isinstance(parsed, dict):
            raise ValueError("API response must be a JSON object")
        return int(response.status), parsed


def _login(
    base_url: str,
    role: str,
    email_env: str,
    password_env: str,
    timeout_seconds: float,
) -> dict[str, str] | None:
    email = str(os.environ.get(email_env) or "").strip()
    password = str(os.environ.get(password_env) or "")
    if not email and not password:
        return None
    if not email or not password:
        raise RuntimeError(f"Both credential environment variables are required for {role}")
    status, payload = _json_request(
        urljoin(base_url, "api/portal/auth/login"),
        method="POST",
        payload={"email": email, "password": password},
        timeout_seconds=timeout_seconds,
    )
    token = str(payload.get("token") or "")
    if status != 200 or payload.get("error") or not token:
        raise RuntimeError(f"Portal login failed for role {role}")
    return {"role": role, "token": token}


def build_read_endpoints(order_ids: list[int]) -> list[str]:
    endpoints = ["api/portal/auth/me", "api/portal/orders"]
    for order_id in order_ids:
        endpoints.extend(
            [
                f"api/portal/orders/{order_id}",
                f"api/portal/orders/{order_id}/updates",
                f"api/portal/orders/{order_id}/messages",
                f"api/portal/orders/{order_id}/media",
            ]
        )
    return endpoints


def _discover_endpoints(
    base_url: str,
    identity: dict[str, str],
    max_orders: int,
    timeout_seconds: float,
) -> list[str]:
    _, payload = _json_request(
        urljoin(base_url, "api/portal/orders"),
        token=identity["token"],
        timeout_seconds=timeout_seconds,
    )
    orders = payload.get("orders")
    if not isinstance(orders, list):
        raise RuntimeError(f"Orders response is invalid for role {identity['role']}")
    order_ids = [
        int(order["id"])
        for order in orders
        if isinstance(order, dict) and isinstance(order.get("id"), int)
    ][:max_orders]
    return build_read_endpoints(order_ids)


def _read_once(
    base_url: str,
    identity: dict[str, str],
    endpoint: str,
    timeout_seconds: float,
) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        status, _ = _json_request(
            urljoin(base_url, endpoint),
            token=identity["token"],
            timeout_seconds=timeout_seconds,
        )
        return {
            "role": identity["role"],
            "endpoint_group": endpoint.rsplit("/", 1)[-1],
            "status_code": status,
            "success": 200 <= status < 300,
            "duration_ms": (time.perf_counter() - started) * 1000,
            "error_type": None,
        }
    except HTTPError as exc:
        return {
            "role": identity["role"],
            "endpoint_group": endpoint.rsplit("/", 1)[-1],
            "status_code": int(exc.code),
            "success": False,
            "duration_ms": (time.perf_counter() - started) * 1000,
            "error_type": type(exc).__name__,
        }
    except (OSError, URLError, ValueError) as exc:
        return {
            "role": identity["role"],
            "endpoint_group": endpoint.rsplit("/", 1)[-1],
            "status_code": None,
            "success": False,
            "duration_ms": (time.perf_counter() - started) * 1000,
            "error_type": type(exc).__name__,
        }


def summarize(samples: list[dict[str, Any]], elapsed_seconds: float) -> dict[str, Any]:
    successes = [sample for sample in samples if sample["success"]]
    durations = [float(sample["duration_ms"]) for sample in successes]
    success_rate = len(successes) / len(samples) if samples else 0.0
    return {
        "result": "pass" if success_rate >= 0.99 and bool(durations) else "fail",
        "request_count": len(samples),
        "success_count": len(successes),
        "failure_count": len(samples) - len(successes),
        "success_rate": round(success_rate, 6),
        "elapsed_seconds": round(elapsed_seconds, 3),
        "achieved_rps": round(len(samples) / elapsed_seconds, 3) if elapsed_seconds else 0.0,
        "latency_ms": {
            "p50": _percentile(durations, 0.50),
            "p95": _percentile(durations, 0.95),
            "p99": _percentile(durations, 0.99),
            "max": round(max(durations), 3) if durations else None,
        },
        "status_counts": dict(
            sorted(Counter(str(item.get("status_code") or "error") for item in samples).items())
        ),
        "error_type_counts": dict(
            sorted(
                Counter(str(item["error_type"]) for item in samples if item.get("error_type")).items()
            )
        ),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:5000/")
    parser.add_argument("--duration-seconds", type=float, default=120.0)
    parser.add_argument("--target-rps", type=float, default=4.0)
    parser.add_argument("--concurrency", type=int, default=6)
    parser.add_argument("--timeout-seconds", type=float, default=10.0)
    parser.add_argument("--max-orders-per-role", type=int, default=5)
    parser.add_argument("--max-requests", type=int, default=2000)
    parser.add_argument("--sales-email-env", default="PHASE4_SALES_EMAIL")
    parser.add_argument("--sales-password-env", default="PHASE4_SALES_PASSWORD")
    parser.add_argument("--customer-email-env", default="PHASE4_CUSTOMER_EMAIL")
    parser.add_argument("--customer-password-env", default="PHASE4_CUSTOMER_PASSWORD")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--allow-non-loopback", action="store_true")
    parser.add_argument("--confirm", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.confirm != CONFIRMATION:
        raise RuntimeError(f"Portal load requires --confirm {CONFIRMATION}")
    base_url = args.base_url.rstrip("/") + "/"
    parsed = urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Base URL must be an absolute HTTP(S) URL")
    if parsed.hostname.lower() not in LOOPBACK_HOSTS and not args.allow_non_loopback:
        raise RuntimeError("Non-loopback targets require --allow-non-loopback")
    if not 5 <= args.duration_seconds <= 600:
        raise ValueError("Duration must be between 5 and 600 seconds")
    if not 0.1 <= args.target_rps <= 50:
        raise ValueError("Target RPS must be between 0.1 and 50")
    if not 1 <= args.concurrency <= 50:
        raise ValueError("Concurrency must be between 1 and 50")

    identities = [
        identity
        for identity in (
            _login(
                base_url,
                "sales",
                args.sales_email_env,
                args.sales_password_env,
                args.timeout_seconds,
            ),
            _login(
                base_url,
                "customer",
                args.customer_email_env,
                args.customer_password_env,
                args.timeout_seconds,
            ),
        )
        if identity is not None
    ]
    if not identities:
        raise RuntimeError("Configure at least one Portal test identity through environment variables")

    endpoints = {
        identity["role"]: _discover_endpoints(
            base_url,
            identity,
            args.max_orders_per_role,
            args.timeout_seconds,
        )
        for identity in identities
    }
    request_count = math.ceil(args.duration_seconds * args.target_rps)
    if request_count > args.max_requests:
        raise RuntimeError(f"Planned request count {request_count} exceeds {args.max_requests}")

    futures: list[Future[dict[str, Any]]] = []
    started = time.perf_counter()
    try:
        with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
            for index in range(request_count):
                identity = identities[index % len(identities)]
                role_endpoints = endpoints[identity["role"]]
                endpoint = role_endpoints[(index // len(identities)) % len(role_endpoints)]
                due = started + index / args.target_rps
                delay = due - time.perf_counter()
                if delay > 0:
                    time.sleep(delay)
                futures.append(
                    executor.submit(
                        _read_once,
                        base_url,
                        identity,
                        endpoint,
                        args.timeout_seconds,
                    )
                )
            samples = [future.result() for future in futures]
    finally:
        for identity in identities:
            try:
                _json_request(
                    urljoin(base_url, "api/portal/auth/logout"),
                    method="POST",
                    token=identity["token"],
                    payload={},
                    timeout_seconds=args.timeout_seconds,
                )
            except (OSError, HTTPError, URLError, ValueError):
                pass

    elapsed = time.perf_counter() - started
    report = {
        "report_type": "phase4_portal_read_load",
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "target_origin": f"{parsed.scheme}://{parsed.netloc}",
        "duration_seconds": args.duration_seconds,
        "target_rps": args.target_rps,
        "concurrency": args.concurrency,
        "roles": [identity["role"] for identity in identities],
        "read_only_business_requests": True,
        **summarize(samples, elapsed),
    }
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(
        f"Portal read load: {report['result']} requests={report['request_count']} "
        f"success_rate={report['success_rate']} p95_ms={report['latency_ms']['p95']}"
    )
    return 0 if report["result"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
