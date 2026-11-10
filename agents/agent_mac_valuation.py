"""
Agent 4 (`agent_mac_valuation.py`) — Macro (USD/IDR, Coal, Nickel, CPO) + LK Solvency.

Extracts the 4D Stalk Vector x_MAC = [mu_5d, theta_star, liquidity_score, h_arb]
from macro currency/commodity tailwinds and Laporan Keuangan (LK) solvency ratios.
"""

from __future__ import annotations

from typing import Any
import numpy as np

from agents.schemas import StalkVector4D


def extract_mac_stalk(raw_market_bundle: dict[str, Any]) -> StalkVector4D:
    """
    Evaluate IDX Macro environment and Laporan Keuangan (LK) financial health into x_MAC.
    """
    ticker = str(raw_market_bundle.get("ticker", "UNKNOWN")).upper()
    m = raw_market_bundle.get("macro_lk", {})

    usd_idr_chg = float(m.get("usd_idr_5d_change_pct", 0.0))
    comm_score = float(m.get("commodity_tailwind_score", 0.0))
    roe_pct = float(m.get("roe_pct", 10.0))
    der = float(m.get("debt_to_equity", 0.8))
    altman_z = float(m.get("altman_z_score", 2.5))
    ocf_ratio = float(m.get("ocf_to_net_income", 1.0))
    pe_z = float(m.get("pe_zscore_5y", 0.0))

    # Rupiah stability + commodity tailwind + ROE above IDX cost of equity (12%) + valuation discount
    fx_term = float(np.clip(-usd_idr_chg * 0.35, -0.50, 0.50))
    roe_term = float(np.clip((roe_pct - 12.0) / 18.0, -0.75, 0.65))
    solvency_term = float(np.clip((altman_z - 2.4) / 2.5 - max(0.0, der - 0.85) * 0.30, -0.80, 0.65))
    val_term = float(np.clip(-pe_z * 0.25, -0.55, 0.45))

    mu_5d = float(
        np.clip(
            0.30 * roe_term + 0.25 * comm_score + 0.20 * fx_term + 0.15 * solvency_term + 0.10 * val_term,
            -0.95,
            0.95,
        )
    )

    # Fundamental anchors mean-revert more steadily over the 5-10 day horizon
    theta_star = float(np.clip(0.38 + 0.25 * max(0.0, solvency_term), 0.18, 0.95))

    # Balance-sheet and operating cash flow cushion
    liquidity_score = float(np.clip(0.50 * (ocf_ratio - 0.5) + 0.50 * solvency_term, -0.90, 0.90))

    # Distress / leverage tail hazard
    h_arb = float(
        np.clip(
            0.25 * max(0.0, der - 1.2) + 0.30 * max(0.0, 2.0 - altman_z) + 0.15 * max(0.0, usd_idr_chg),
            0.03,
            0.88,
        )
    )

    rationale = (
        f"Macro/LK: ROE={roe_pct:.1f}%, DER={der:.2f}x, AltmanZ={altman_z:.2f}, "
        f"USD/IDR 5d={usd_idr_chg:+.2f}% -> mu_5d={mu_5d:+.2f}."
    )

    return StalkVector4D(
        agent_id="MAC",
        ticker=ticker,
        mu_5d=round(mu_5d, 6),
        theta_star=round(theta_star, 6),
        liquidity_score=round(liquidity_score, 6),
        h_arb=round(h_arb, 6),
        summary_rationale=rationale,
        diagnostics={
            "usd_idr": float(m.get("usd_idr", 15700.0)),
            "usd_idr_5d_change_pct": usd_idr_chg,
            "roe_pct": roe_pct,
            "debt_to_equity": der,
            "altman_z_score": altman_z,
            "ocf_to_net_income": ocf_ratio,
            "pe_zscore_5y": pe_z,
        },
    )
