"""
High-Speed Native Rust Mathematical Kernel Bridge (`rust_client.py`).

Provides transparent HTTP client bindings to `swrt-rust-kernel` (Axum/Tokio on port 4001)
with sub-millisecond execution times and zero-overhead fallback to local Python
algorithms in `services.swrt_math_kernel_mcp.server` when the Rust microservice is offline.
"""

from __future__ import annotations

import json
import os
import socket
import time
import urllib.error
import urllib.request
from typing import Any

from services.swrt_math_kernel_mcp.server import (
    compute_lob_rough_signature as py_compute_lob_rough_signature,
    compute_sheaf_cohomology as py_compute_sheaf_cohomology,
    compute_sinkhorn_bandar_flow as py_compute_sinkhorn_bandar_flow,
    solve_ou_optimal_stopping as py_solve_ou_optimal_stopping,
    solve_wdro_lot_sizing as py_solve_wdro_lot_sizing,
)

DEFAULT_RUST_URL = "http://swrt-rust-kernel:4001"
LOCAL_FALLBACK_RUST_URL = "http://127.0.0.1:4001"

_cached_target_url: str | None = None
_offline_until_ts: float = 0.0
OFFLINE_COOLDOWN_SEC = 3.0


def get_rust_kernel_url() -> str:
    """Return the configured or discovered Rust kernel base URL."""
    env_url = os.environ.get("SWRT_RUST_KERNEL_URL") or os.environ.get("RUST_KERNEL_URL")
    if env_url:
        return env_url.rstrip("/")
    global _cached_target_url
    if _cached_target_url:
        return _cached_target_url
    return DEFAULT_RUST_URL


def is_rust_kernel_healthy(timeout: float = 0.5) -> bool:
    """Check whether the Rust kernel is responsive on /health."""
    urls = [get_rust_kernel_url()]
    if urls[0] != LOCAL_FALLBACK_RUST_URL:
        urls.append(LOCAL_FALLBACK_RUST_URL)

    for base in urls:
        try:
            req = urllib.request.Request(
                f"{base}/health",
                headers={"Accept": "application/json"},
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    global _cached_target_url, _offline_until_ts
                    _cached_target_url = base
                    _offline_until_ts = 0.0
                    return True
        except Exception:
            continue
    return False


def _post_json(endpoint: str, payload: dict[str, Any], timeout: float = 1.5) -> dict[str, Any] | None:
    """
    Attempt POST request to the Rust kernel endpoint.
    Returns parsed JSON dictionary or None on failure/timeout.
    """
    global _offline_until_ts, _cached_target_url
    now = time.time()
    if now < _offline_until_ts:
        return None

    primary_url = get_rust_kernel_url()
    candidate_urls = [primary_url]
    if primary_url == DEFAULT_RUST_URL:
        candidate_urls.append(LOCAL_FALLBACK_RUST_URL)

    encoded_bytes = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    for base_url in candidate_urls:
        target_endpoint = f"{base_url}{endpoint}"
        try:
            req = urllib.request.Request(
                target_endpoint,
                data=encoded_bytes,
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    resp_data = resp.read()
                    parsed = json.loads(resp_data.decode("utf-8"))
                    _cached_target_url = base_url
                    return parsed
        except (
            urllib.error.URLError,
            urllib.error.HTTPError,
            socket.timeout,
            TimeoutError,
            ConnectionError,
            OSError,
        ):
            continue
        except Exception:
            continue

    # Set temporary cooldown to prevent blocking subsequent local tests
    _offline_until_ts = time.time() + OFFLINE_COOLDOWN_SEC
    return None


# ============================================================================
# PILLAR 1: SINKHORN-KNOPP ENTROPIC OPTIMAL TRANSPORT
# ============================================================================
def compute_sinkhorn_bandar_flow(
    brokers_buy: list[dict[str, Any]],
    brokers_sell: list[dict[str, Any]],
    reg_epsilon: float = 0.08,
) -> dict[str, Any]:
    """Execute Pillar 1 via Rust Axum service or local Python fallback."""
    payload = {
        "brokers_buy": brokers_buy,
        "brokers_sell": brokers_sell,
        "reg_epsilon": reg_epsilon,
    }
    rust_resp = _post_json("/v1/sinkhorn", payload)
    if rust_resp is not None and "conviction_kappa" in rust_resp:
        rust_resp.setdefault("engine", "rust-axum-native")
        rust_resp.setdefault("compute_engine", "rust-axum-native")
        return rust_resp

    t0 = time.perf_counter()
    py_res = py_compute_sinkhorn_bandar_flow(
        brokers_buy=brokers_buy,
        brokers_sell=brokers_sell,
        reg_epsilon=reg_epsilon,
    )
    py_res["kernel_latency_us"] = int((time.perf_counter() - t0) * 1_000_000)
    py_res["engine"] = "python-fallback"
    py_res["compute_engine"] = "python-fallback"
    return py_res


# ============================================================================
# PILLAR 2: DEPTH-3 LOB ROUGH PATH SIGNATURE & LEVY AREA
# ============================================================================
def compute_lob_rough_signature(
    micro_prices: list[float],
    ofi_series: list[float],
    cancel_rates: list[float],
    bid_levels_lots: list[float],
    ask_levels_lots: list[float],
    prev_close_rp: int,
    last_price_rp: int,
) -> dict[str, Any]:
    """Execute Pillar 2 via Rust Axum service or local Python fallback."""
    payload = {
        "micro_prices": [float(x) for x in micro_prices],
        "ofi_series": [float(x) for x in ofi_series],
        "cancel_rates": [float(x) for x in cancel_rates],
        "bid_levels_lots": [float(x) for x in bid_levels_lots],
        "ask_levels_lots": [float(x) for x in ask_levels_lots],
        "prev_close_rp": int(prev_close_rp),
        "last_price_rp": int(last_price_rp),
    }
    rust_resp = _post_json("/v1/rough-signature", payload)
    if rust_resp is not None and "h_arb" in rust_resp:
        rust_resp.setdefault("engine", "rust-axum-native")
        rust_resp.setdefault("compute_engine", "rust-axum-native")
        return rust_resp

    t0 = time.perf_counter()
    py_res = py_compute_lob_rough_signature(
        micro_prices=micro_prices,
        ofi_series=ofi_series,
        cancel_rates=cancel_rates,
        bid_levels_lots=bid_levels_lots,
        ask_levels_lots=ask_levels_lots,
        prev_close_rp=prev_close_rp,
        last_price_rp=last_price_rp,
    )
    py_res["kernel_latency_us"] = int((time.perf_counter() - t0) * 1_000_000)
    py_res["engine"] = "python-fallback"
    py_res["compute_engine"] = "python-fallback"
    return py_res


# ============================================================================
# PILLAR 3: CELLULAR SHEAF LAPLACIAN & COHOMOLOGY FAULT EXTRACTOR
# ============================================================================
def compute_sheaf_cohomology(
    stalks_by_agent: dict[str, list[float]],
    cohomology_threshold: float = 0.70,
) -> dict[str, Any]:
    """Execute Pillar 3 via Rust Axum service or local Python fallback."""
    payload = {
        "stalks_by_agent": {k: [float(v) for v in vals] for k, vals in stalks_by_agent.items()},
        "cohomology_threshold": float(cohomology_threshold),
    }
    rust_resp = _post_json("/v1/sheaf-cohomology", payload)
    if rust_resp is not None and "sheaf_phi" in rust_resp:
        rust_resp.setdefault("engine", "rust-axum-native")
        rust_resp.setdefault("compute_engine", "rust-axum-native")
        return rust_resp

    t0 = time.perf_counter()
    py_res = py_compute_sheaf_cohomology(
        stalks_by_agent=stalks_by_agent,
        cohomology_threshold=cohomology_threshold,
    )
    py_res["kernel_latency_us"] = int((time.perf_counter() - t0) * 1_000_000)
    py_res["engine"] = "python-fallback"
    py_res["compute_engine"] = "python-fallback"
    return py_res


# ============================================================================
# PILLAR 4: WASSERSTEIN DISTRIBUTIONALLY ROBUST OPTIMIZATION (WDRO)
# ============================================================================
def solve_wdro_lot_sizing(
    sheaf_phi: float,
    consensus_stalk: list[float],
    entry_price_rp: int,
    capital_rp: float = 100_000_000.0,
    max_position_pct: float = 0.25,
    adv_lots: int = 50_000,
    cohomology_threshold: float = 0.70,
    arb_hazard_threshold: float = 0.65,
) -> dict[str, Any]:
    """Execute Pillar 4 via Rust Axum service or local Python fallback."""
    payload = {
        "sheaf_phi": float(sheaf_phi),
        "consensus_stalk": [float(x) for x in consensus_stalk],
        "entry_price_rp": int(entry_price_rp),
        "capital_rp": float(capital_rp),
        "max_position_pct": float(max_position_pct),
        "adv_lots": int(adv_lots),
        "cohomology_threshold": float(cohomology_threshold),
        "arb_hazard_threshold": float(arb_hazard_threshold),
    }
    rust_resp = _post_json("/v1/wdro-lots", payload)
    if rust_resp is not None and "action" in rust_resp:
        rust_resp.setdefault("engine", "rust-axum-native")
        rust_resp.setdefault("compute_engine", "rust-axum-native")
        return rust_resp

    t0 = time.perf_counter()
    py_res = py_solve_wdro_lot_sizing(
        sheaf_phi=sheaf_phi,
        consensus_stalk=consensus_stalk,
        entry_price_rp=entry_price_rp,
        capital_rp=capital_rp,
        max_position_pct=max_position_pct,
        adv_lots=adv_lots,
        cohomology_threshold=cohomology_threshold,
        arb_hazard_threshold=arb_hazard_threshold,
    )
    py_res["kernel_latency_us"] = int((time.perf_counter() - t0) * 1_000_000)
    py_res["engine"] = "python-fallback"
    py_res["compute_engine"] = "python-fallback"
    return py_res


# ============================================================================
# PILLAR 5: ORNSTEIN-UHLENBECK OPTIMAL STOPPING
# ============================================================================
def solve_ou_optimal_stopping(
    prev_close_rp: int,
    current_price_rp: int,
    consensus_stalk: list[float],
    sheaf_phi: float,
    epsilon_phi: float,
    approved_lots: int,
    reference_date: str = "2026-10-28",
) -> dict[str, Any]:
    """Execute Pillar 5 via Rust Axum service or local Python fallback."""
    payload = {
        "prev_close_rp": int(prev_close_rp),
        "current_price_rp": int(current_price_rp),
        "consensus_stalk": [float(x) for x in consensus_stalk],
        "sheaf_phi": float(sheaf_phi),
        "epsilon_phi": float(epsilon_phi),
        "approved_lots": int(approved_lots),
        "reference_date": str(reference_date),
    }
    rust_resp = _post_json("/v1/ou-stopping", payload)
    if rust_resp is not None and "entry_limit_rp" in rust_resp:
        rust_resp.setdefault("engine", "rust-axum-native")
        rust_resp.setdefault("compute_engine", "rust-axum-native")
        return rust_resp

    t0 = time.perf_counter()
    py_res = py_solve_ou_optimal_stopping(
        prev_close_rp=prev_close_rp,
        current_price_rp=current_price_rp,
        consensus_stalk=consensus_stalk,
        sheaf_phi=sheaf_phi,
        epsilon_phi=epsilon_phi,
        approved_lots=approved_lots,
        reference_date=reference_date,
    )
    py_res["kernel_latency_us"] = int((time.perf_counter() - t0) * 1_000_000)
    py_res["engine"] = "python-fallback"
    py_res["compute_engine"] = "python-fallback"
    return py_res


# ============================================================================
# COMBINED PILLAR 3 + 4 + 5 SOLVER
# ============================================================================
def solve_sheaf_wdro_ou(
    stalks_by_agent: dict[str, list[float]],
    prev_close_rp: int,
    last_price_rp: int,
    capital_rp: float = 100_000_000.0,
    max_position_pct: float = 0.25,
    adv_lots: int = 50_000,
    cohomology_threshold: float = 0.70,
    arb_hazard_threshold: float = 0.65,
    reference_date: str = "2026-10-28",
) -> dict[str, Any]:
    """
    Execute Sheaf Cohomology, WDRO Lot Sizing, and OU Stopping in a single
    microsecond round-trip to the Rust kernel or seamless Python fallback.
    """
    payload = {
        "stalks_by_agent": {k: [float(v) for v in vals] for k, vals in stalks_by_agent.items()},
        "cohomology_threshold": float(cohomology_threshold),
        "arb_hazard_threshold": float(arb_hazard_threshold),
        "prev_close_rp": int(prev_close_rp),
        "last_price_rp": int(last_price_rp),
        "capital_rp": float(capital_rp),
        "max_position_pct": float(max_position_pct),
        "adv_lots": int(adv_lots),
        "reference_date": str(reference_date),
    }

    rust_resp = _post_json("/v1/solve-sheaf-wdro-ou", payload)
    if rust_resp is not None and "sheaf" in rust_resp and "wdro" in rust_resp and "ou" in rust_resp:
        return rust_resp

    # Local Python fallback: execute individual pillars sequentially
    t0 = time.perf_counter()
    sheaf_res = py_compute_sheaf_cohomology(
        stalks_by_agent=stalks_by_agent,
        cohomology_threshold=cohomology_threshold,
    )
    sheaf_phi = float(sheaf_res["sheaf_phi"])
    consensus_stalk = [float(x) for x in sheaf_res["consensus_stalk"]]

    from services.swrt_math_kernel_mcp.idx_rules import round_to_idx_tick
    prelim_entry_rp = round_to_idx_tick(last_price_rp, mode="floor")

    wdro_res = py_solve_wdro_lot_sizing(
        sheaf_phi=sheaf_phi,
        consensus_stalk=consensus_stalk,
        entry_price_rp=prelim_entry_rp,
        capital_rp=capital_rp,
        max_position_pct=max_position_pct,
        adv_lots=adv_lots,
        cohomology_threshold=cohomology_threshold,
        arb_hazard_threshold=arb_hazard_threshold,
    )
    approved_lots = int(wdro_res["approved_lots"])
    epsilon_phi = float(wdro_res["epsilon_phi"])

    ou_res = py_solve_ou_optimal_stopping(
        prev_close_rp=prev_close_rp,
        current_price_rp=last_price_rp,
        consensus_stalk=consensus_stalk,
        sheaf_phi=sheaf_phi,
        epsilon_phi=epsilon_phi,
        approved_lots=approved_lots,
        reference_date=reference_date,
    )
    elapsed_us = int((time.perf_counter() - t0) * 1_000_000)

    return {
        "sheaf": sheaf_res,
        "wdro": wdro_res,
        "ou": ou_res,
        "kernel_latency_us": elapsed_us,
        "engine": "python-fallback",
    }
