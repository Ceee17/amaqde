"""
Dedicated SWRT Audit-Tap Microservice (`services/audit_tap_service/server.py`).

Runs on port 4002 (or AUDIT_TAP_PORT) via Python's built-in `http.server.ThreadingHTTPServer`.
Features:
- Segregated unbuffered stdout logging `[swrt-audit-tap] ...` for real-time `docker compose logs` observability.
- Automatic seeding of the 3 canonical regimes (BBCA, BREN, GOTO) on startup if `latest_receipts.json` is missing.
- Endpoints:
  - GET /health
  - GET /v1/receipts
  - POST /v1/pipeline/run
"""

from __future__ import annotations

import json
import os
import signal
import sys
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from agents.agent_exe_unifier import run_all_canonical_regimes, run_swrt_pipeline
from services.swrt_math_kernel_mcp.rust_client import get_rust_kernel_url, is_rust_kernel_healthy


def log(msg: str) -> None:
    """Print unbuffered timestamped logs with [swrt-audit-tap] tag."""
    now_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print(f"[swrt-audit-tap] {now_str} | {msg}", flush=True)


def get_vault_dir() -> Path:
    """Resolve vault directory path from environment or default."""
    vault_str = os.environ.get("SWRT_VAULT_DIR") or "audit_vault"
    vault_path = Path(vault_str)
    vault_path.mkdir(parents=True, exist_ok=True)
    return vault_path


def get_latest_receipts_path() -> Path:
    return get_vault_dir() / "latest_receipts.json"


def ensure_seeded_ledger() -> dict[str, Any]:
    """Ensure latest_receipts.json exists, seeding canonical regimes if missing."""
    receipts_file = get_latest_receipts_path()
    vault_dir_str = str(get_vault_dir())

    if not receipts_file.exists():
        log("No audit_vault/latest_receipts.json found. Seeding 3 canonical regimes (BBCA, BREN, GOTO)...")
        cards = run_all_canonical_regimes(vault_dir=vault_dir_str)
        log(
            f"Successfully seeded {len(cards)} canonical regime receipts "
            f"into {receipts_file.as_posix()}."
        )

    try:
        raw_text = receipts_file.read_text(encoding="utf-8")
        return json.loads(raw_text)
    except Exception as exc:
        log(f"Warning: could not read {receipts_file}: {exc}. Re-running canonical regimes...")
        run_all_canonical_regimes(vault_dir=vault_dir_str)
        return json.loads(receipts_file.read_text(encoding="utf-8"))


class AuditTapHandler(BaseHTTPRequestHandler):
    server_version = "swrt-audit-tap/1.0.0"

    def _send_json_response(self, data: Any, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?")[0].rstrip("/")
        if not path:
            path = "/"

        if path in ("/health", "/"):
            rust_url = get_rust_kernel_url()
            rust_ok = is_rust_kernel_healthy()
            res = {
                "status": "ok",
                "service": "swrt-audit-tap",
                "rust_kernel_url": rust_url,
                "rust_kernel_healthy": rust_ok,
                "pid": os.getpid(),
            }
            self._send_json_response(res, status=HTTPStatus.OK)
            return

        if path in ("/v1/receipts", "/receipts"):
            t0 = time.perf_counter()
            data = ensure_seeded_ledger()
            lat_ms = (time.perf_counter() - t0) * 1000.0
            receipts_count = len(data.get("receipts", []))
            log(f"GET {path} -> 200 OK | {receipts_count} receipts served in {lat_ms:.2f}ms")
            self._send_json_response(data, status=HTTPStatus.OK)
            return

        log(f"GET {path} -> 404 Not Found")
        self._send_json_response({"error": f"Path '{path}' not found"}, status=HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        path = self.path.split("?")[0].rstrip("/")
        if path not in ("/v1/pipeline/run", "/pipeline/run"):
            log(f"POST {path} -> 404 Not Found")
            self._send_json_response({"error": f"Path '{path}' not found"}, status=HTTPStatus.NOT_FOUND)
            return

        t0 = time.perf_counter()
        try:
            content_len = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"
            req_json = json.loads(raw_body) if raw_body else {}
        except Exception as exc:
            log(f"POST {path} -> 400 Bad Request (Invalid JSON: {exc})")
            self._send_json_response({"error": f"Invalid JSON body: {exc}"}, status=HTTPStatus.BAD_REQUEST)
            return

        ticker = str(req_json.get("ticker", "BBCA")).upper().strip()
        regime = str(req_json.get("regime", "COHERENT_ACCUMULATION")).upper().strip()
        capital_rp = float(req_json.get("capital_rp", 100_000_000.0))

        log(f"POST /v1/pipeline/run -> Executing SWRT pipeline for ticker={ticker}, regime={regime}, capital=Rp{capital_rp:,.0f}...")

        try:
            vault_dir_str = str(get_vault_dir())
            card = run_swrt_pipeline(
                ticker=ticker,
                regime=regime,
                capital_rp=capital_rp,
                vault_dir=vault_dir_str,
            )

            # Read latest receipts mirror updated by commit_merkle_receipt
            receipts_file = get_latest_receipts_path()
            if receipts_file.exists():
                latest_payload = json.loads(receipts_file.read_text(encoding="utf-8"))
            else:
                latest_payload = ensure_seeded_ledger()

            diag = card.pillar_diagnostics or {}
            rust_lat_us = int(diag.get("rust_kernel_latency_us", 0))
            compute_engine = str(diag.get("compute_engine", "python-fallback"))
            elapsed_ms = (time.perf_counter() - t0) * 1000.0

            log(
                f"POST /v1/pipeline/run -> SUCCESS | ticker={card.ticker} action={card.action} "
                f"lots={card.approved_lots} engine={compute_engine} rust_lat={rust_lat_us}us "
                f"total={elapsed_ms:.1f}ms | receipt={card.receipt_sha256[:16]}..."
            )

            # Response combines updated receipts mirror for frontend gate + decision card + latency
            res_data = dict(latest_payload)
            res_data["status"] = "ok"
            res_data["decision"] = card.model_dump()
            res_data["rust_kernel_latency_us"] = rust_lat_us
            res_data["compute_engine"] = compute_engine
            res_data["elapsed_ms"] = round(elapsed_ms, 2)

            self._send_json_response(res_data, status=HTTPStatus.OK)
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            log(f"POST /v1/pipeline/run -> ERROR after {elapsed_ms:.1f}ms: {exc}")
            self._send_json_response(
                {"error": f"Pipeline execution failed: {exc}", "status": "error"},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )

    def log_message(self, format: str, *args: Any) -> None:
        """Suppress default BaseHTTPRequestHandler stderr logs in favor of [swrt-audit-tap]."""
        return


def main() -> None:
    port = int(os.environ.get("AUDIT_TAP_PORT") or os.environ.get("PORT") or 4002)
    host = "0.0.0.0"

    log("=" * 70)
    log(f"Starting SWRT Audit-Tap Microservice on {host}:{port}")
    log(f"Vault Directory: {get_vault_dir().resolve().as_posix()}")
    rust_url = get_rust_kernel_url()
    rust_ok = is_rust_kernel_healthy()
    log(f"Rust Kernel URL: {rust_url} (Live: {rust_ok})")
    log("=" * 70)

    # Seed canonical regimes if initial ledger does not exist
    ensure_seeded_ledger()

    server = ThreadingHTTPServer((host, port), AuditTapHandler)

    def shutdown_signal(sig: int, frame: Any) -> None:
        log(f"Received signal {sig}. Gracefully shutting down swrt-audit-tap...")
        server.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown_signal)
    signal.signal(signal.SIGTERM, shutdown_signal)

    log(f"SWRT Audit-Tap is ready and listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("Server stopped by operator.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
