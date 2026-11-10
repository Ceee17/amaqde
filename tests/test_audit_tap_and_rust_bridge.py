"""
Unit & Integration Tests for Rust Client Bridge & swrt-audit-tap Microservice.
(`tests/test_audit_tap_and_rust_bridge.py`)

Verifies:
1. `rust_client.py` transparent fallback to local Python when native Rust kernel is offline.
2. `compute_engine` and `rust_kernel_latency_us` tracking in `UnifiedDecisionCard.pillar_diagnostics`.
3. `swrt-audit-tap` microservice endpoints (`/health`, `/v1/receipts`, `/v1/pipeline/run`)
   and startup canonical seeding.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.request
from pathlib import Path
import pytest

from agents.agent_exe_unifier import run_swrt_pipeline
from services.audit_tap_service.server import AuditTapHandler, ThreadingHTTPServer, ensure_seeded_ledger
from services.swrt_math_kernel_mcp.rust_client import (
    compute_lob_rough_signature,
    compute_sheaf_cohomology,
    compute_sinkhorn_bandar_flow,
    get_rust_kernel_url,
    is_rust_kernel_healthy,
    solve_ou_optimal_stopping,
    solve_sheaf_wdro_ou,
    solve_wdro_lot_sizing,
)


def test_rust_client_fallback_behavior() -> None:
    """Verify that all 5 mathematical pillars execute properly via rust_client with fallback."""
    # 1. Pillar 1: Sinkhorn
    buy_brokers = [{"broker": "CC", "lots": 50000, "avg_price": 9900}]
    sell_brokers = [{"broker": "YP", "lots": 50000, "avg_price": 9900}]
    ot_res = compute_sinkhorn_bandar_flow(buy_brokers, sell_brokers, reg_epsilon=0.08)
    assert "conviction_kappa" in ot_res
    assert "kernel_latency_us" in ot_res
    assert ot_res.get("engine") in ("rust-axum-native", "python-fallback")

    # 2. Pillar 2: Rough Path LOB
    lob_res = compute_lob_rough_signature(
        micro_prices=[9900.0, 9905.0, 9910.0, 9915.0],
        ofi_series=[100.0, 150.0, 180.0, 220.0],
        cancel_rates=[0.1, 0.12, 0.08, 0.09],
        bid_levels_lots=[1000.0, 800.0],
        ask_levels_lots=[500.0, 400.0],
        prev_close_rp=9800,
        last_price_rp=9900,
    )
    assert "h_arb" in lob_res
    assert "lob_mu_5d" in lob_res
    assert "kernel_latency_us" in lob_res

    # 3. Pillar 3: Sheaf
    stalks = {
        "BDM": [0.45, 0.70, 0.50, 0.10],
        "LOB": [0.40, 0.65, 0.45, 0.12],
        "NLP": [0.35, 0.60, 0.40, 0.08],
        "MAC": [0.30, 0.55, 0.35, 0.15],
    }
    sheaf_res = compute_sheaf_cohomology(stalks, cohomology_threshold=0.70)
    assert "sheaf_phi" in sheaf_res
    assert sheaf_res["sheaf_phi"] < 0.30

    # 4. Pillar 4: WDRO
    wdro_res = solve_wdro_lot_sizing(
        sheaf_phi=sheaf_res["sheaf_phi"],
        consensus_stalk=sheaf_res["consensus_stalk"],
        entry_price_rp=9900,
        capital_rp=100_000_000.0,
    )
    assert wdro_res["action"] == "BUY"
    assert wdro_res["approved_lots"] > 0

    # 5. Pillar 5: OU Stopping
    ou_res = solve_ou_optimal_stopping(
        prev_close_rp=9800,
        current_price_rp=9900,
        consensus_stalk=sheaf_res["consensus_stalk"],
        sheaf_phi=sheaf_res["sheaf_phi"],
        epsilon_phi=wdro_res["epsilon_phi"],
        approved_lots=wdro_res["approved_lots"],
    )
    assert ou_res["entry_limit_rp"] > 0
    assert ou_res["take_profit_rp"] > ou_res["entry_limit_rp"]
    assert len(ou_res["trajectory_cone"]) == 11

    # 6. Combined Pillar 3 + 4 + 5
    combined = solve_sheaf_wdro_ou(
        stalks_by_agent=stalks,
        prev_close_rp=9800,
        last_price_rp=9900,
        capital_rp=100_000_000.0,
    )
    assert "sheaf" in combined
    assert "wdro" in combined
    assert "ou" in combined
    assert combined["wdro"]["action"] == "BUY"


def test_unifier_records_diagnostics_compute_engine(tmp_path: Path) -> None:
    """Verify that run_swrt_pipeline records compute_engine and rust_kernel_latency_us in pillar_diagnostics."""
    card = run_swrt_pipeline(
        ticker="BBCA",
        regime="COHERENT_ACCUMULATION",
        capital_rp=100_000_000.0,
        vault_dir=str(tmp_path / "audit_vault"),
    )
    assert "pillar_diagnostics" in card.model_dump()
    diag = card.pillar_diagnostics
    assert "compute_engine" in diag
    assert diag["compute_engine"] in ("rust-axum-native", "python-fallback")
    assert "rust_kernel_latency_us" in diag
    assert isinstance(diag["rust_kernel_latency_us"], int)
    assert diag["rust_kernel_latency_us"] >= 0


def test_audit_tap_http_service(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify swrt-audit-tap ThreadingHTTPServer endpoints (/health, /v1/receipts, /v1/pipeline/run)."""
    vault_dir = tmp_path / "audit_vault"
    monkeypatch.setenv("SWRT_VAULT_DIR", str(vault_dir))

    # Pick an ephemeral test port
    test_port = 4088
    server = ThreadingHTTPServer(("127.0.0.1", test_port), AuditTapHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    time.sleep(0.3)

    base_url = f"http://127.0.0.1:{test_port}"
    try:
        # 1. GET /health
        req = urllib.request.Request(f"{base_url}/health")
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            assert resp.status == 200
            data = json.loads(resp.read().decode("utf-8"))
            assert data["status"] == "ok"
            assert data["service"] == "swrt-audit-tap"
            assert "rust_kernel_url" in data

        # 2. GET /v1/receipts (should auto-seed canonical regimes)
        req = urllib.request.Request(f"{base_url}/v1/receipts")
        with urllib.request.urlopen(req, timeout=10.0) as resp:
            assert resp.status == 200
            data = json.loads(resp.read().decode("utf-8"))
            assert "receipts" in data
            assert len(data["receipts"]) >= 3
            assert data["verification"]["valid"] is True

        # 3. POST /v1/pipeline/run
        post_body = json.dumps({
            "ticker": "BBCA",
            "regime": "COHERENT_ACCUMULATION",
            "capital_rp": 100_000_000.0,
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{base_url}/v1/pipeline/run",
            data=post_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15.0) as resp:
            assert resp.status == 200
            run_data = json.loads(resp.read().decode("utf-8"))
            assert run_data["status"] == "ok"
            assert run_data["decision"]["ticker"] == "BBCA"
            assert run_data["decision"]["action"] == "BUY"
            assert "receipts" in run_data
            assert "rust_kernel_latency_us" in run_data
            assert "compute_engine" in run_data
    finally:
        server.shutdown()
        server.server_close()
