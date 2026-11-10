"""
Agent 2 (`agent_lob_rough.py`) — Pillar 2: Rough Path Signatures & 7% ARB Hazard.

Extracts the 4D Stalk Vector x_LOB = [mu_5d, theta_star, liquidity_score, h_arb]
from the L2 Orderbook & 1,000 Running Trade ticks via `compute_lob_rough_signature`.
"""

from __future__ import annotations

from typing import Any
import numpy as np

from agents.schemas import StalkVector4D
from services.swrt_math_kernel_mcp.rust_client import compute_lob_rough_signature


def extract_lob_stalk(raw_market_bundle: dict[str, Any]) -> StalkVector4D:
    """
    Compute the deterministic 4D Limit Order Book stalk vector x_LOB using the
    Depth-3 Rough Path Signature and Lévy Area spoofing detector.
    """
    ticker = str(raw_market_bundle.get("ticker", "UNKNOWN")).upper()
    prev_close_rp = int(raw_market_bundle.get("prev_close_rp", 1000))
    last_price_rp = int(raw_market_bundle.get("last_price_rp", 1000))
    ob = raw_market_bundle.get("orderbook", {})

    sig_res = compute_lob_rough_signature(
        micro_prices=ob.get("micro_prices", []),
        ofi_series=ob.get("ofi_series", []),
        cancel_rates=ob.get("cancel_rates", []),
        bid_levels_lots=ob.get("bid_levels_lots", []),
        ask_levels_lots=ob.get("ask_levels_lots", []),
        prev_close_rp=prev_close_rp,
        last_price_rp=last_price_rp,
    )

    mu_5d = float(sig_res["lob_mu_5d"])
    liquidity_score = float(sig_res["liquidity_score"])
    h_arb = float(sig_res["h_arb"])
    spoofing_intensity = float(sig_res["spoofing_intensity"])

    # OU relaxation rate scales with genuine book resilience and inverse spoofing
    theta_star = float(
        np.clip(0.45 + 0.35 * max(0.0, liquidity_score) - 0.20 * spoofing_intensity, 0.15, 1.40)
    )

    if sig_res["spoofing_detected"]:
        rationale = (
            f"Rough Path Lévy Area A_{{OFI,Cancel}}={sig_res['levy_ofi_cancel']:+.3f} "
            f"detects phantom bid wall spoofing (intensity={spoofing_intensity:.2f})."
        )
    elif h_arb > 0.65:
        rationale = (
            f"Critical -7% ARB queue depletion hazard (h_ARB={h_arb:.2f}, "
            f"dist_to_ARB={sig_res['dist_to_arb_pct']:.2%})."
        )
    else:
        rationale = (
            f"Healthy L2 bid cushion (book_imbalance={sig_res['book_imbalance']:+.2f}, "
            f"h_ARB={h_arb:.2f})."
        )

    return StalkVector4D(
        agent_id="LOB",
        ticker=ticker,
        mu_5d=round(mu_5d, 6),
        theta_star=round(theta_star, 6),
        liquidity_score=round(liquidity_score, 6),
        h_arb=round(h_arb, 6),
        summary_rationale=rationale,
        diagnostics=sig_res,
    )
