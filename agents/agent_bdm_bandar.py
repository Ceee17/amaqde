"""
Agent 1 (`agent_bdm_bandar.py`) — Pillar 1: Entropic Optimal Transport (Sinkhorn-Knopp).

Extracts the 4D Stalk Vector x_BDM = [mu_5d, theta_star, liquidity_score, h_arb]
by passing the raw Intraday Broker Summary matrix through `compute_sinkhorn_bandar_flow`
in `services.swrt_math_kernel_mcp.server`.
"""

from __future__ import annotations

from typing import Any
import numpy as np

from agents.schemas import StalkVector4D
from services.swrt_math_kernel_mcp.rust_client import compute_sinkhorn_bandar_flow


def extract_bdm_stalk(raw_market_bundle: dict[str, Any]) -> StalkVector4D:
    """
    Compute the deterministic 4D Bandar Flow stalk vector x_BDM using Sinkhorn-Knopp
    Optimal Transport over the IDX Broker Summary.
    """
    ticker = str(raw_market_bundle.get("ticker", "UNKNOWN")).upper()
    broker_summary = raw_market_bundle.get("broker_summary", {})
    brokers_buy = broker_summary.get("brokers_buy", [])
    brokers_sell = broker_summary.get("brokers_sell", [])

    ot_res = compute_sinkhorn_bandar_flow(
        brokers_buy=brokers_buy,
        brokers_sell=brokers_sell,
        reg_epsilon=0.08,
    )

    kappa = float(ot_res["conviction_kappa"])
    retail_to_inst = float(ot_res["retail_to_inst_flow"])
    inst_to_retail = float(ot_res["inst_to_retail_flow"])
    wash_ratio = float(ot_res["self_loop_wash_ratio"])
    net_inst = float(ot_res.get("net_inst_pressure", 0.0))

    # 1. mu_5d: 5-day directional conviction from Sinkhorn institutional accumulation vs distribution
    mu_5d = float(np.clip(0.65 * kappa + 0.35 * (retail_to_inst - inst_to_retail), -0.98, 0.98))

    # 2. theta_star: OU mean-reversion speed (faster convergence when top-3 institutional concentration is high)
    top3_conc = float(ot_res.get("top3_buy_concentration", 0.5))
    theta_star = float(np.clip(0.35 + 0.55 * top3_conc, 0.15, 1.45))

    # 3. liquidity_score: genuine institutional sponsorship net of wash-trading self-loops
    liquidity_score = float(np.clip(0.60 * net_inst + 0.40 * (1.0 - 2.0 * wash_ratio), -0.95, 0.95))

    # 4. h_arb: Bandar dump / institutional liquidation tail hazard
    h_arb = float(np.clip(0.55 * inst_to_retail + 0.35 * max(0.0, -net_inst) + 0.10 * wash_ratio, 0.02, 0.95))

    if mu_5d >= 0.35:
        rationale = (
            f"Sinkhorn OT detects net institutional stealth accumulation "
            f"(Retail->Inst={retail_to_inst:.1%}, kappa={kappa:+.2f})."
        )
    elif mu_5d <= -0.35:
        rationale = (
            f"Sinkhorn OT flags heavy Bandar distribution into Retail hands "
            f"(Inst->Retail={inst_to_retail:.1%}, kappa={kappa:+.2f})."
        )
    else:
        rationale = f"Balanced broker transport coupling (kappa={kappa:+.2f})."

    return StalkVector4D(
        agent_id="BDM",
        ticker=ticker,
        mu_5d=round(mu_5d, 6),
        theta_star=round(theta_star, 6),
        liquidity_score=round(liquidity_score, 6),
        h_arb=round(h_arb, 6),
        summary_rationale=rationale,
        diagnostics=ot_res,
    )
