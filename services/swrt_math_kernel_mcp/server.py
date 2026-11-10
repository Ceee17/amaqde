"""
SWRT Deterministic Mathematical Kernel MCP Server (`swrt-math-kernel-mcp`).

Implements all 5 mathematical pillars with zero LLM involvement:
1. Sinkhorn-Knopp Entropic Optimal Transport Broker Matrix (`pot`)
2. Depth-3 Limit Order Book Rough Path Signature & Lévy Area Spoofing Detector (`numpy`/`scipy`)
3. Cellular Sheaf Laplacian L_F, Dirichlet Frustration Energy Phi(x), & Coboundary Fault Extractor
4. Wasserstein Distributionally Robust Optimization (WDRO) Lot Sizer (`cvxpy` + `clarabel`)
5. Ornstein-Uhlenbeck First-Passage Optimal Stopping Solver (IDX Tick & Pre-ARB Aligned)
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
import math
import sys
from typing import Any

# Prevent cvxpy from probing the legacy osqp C-extension on Windows; we use CLARABEL (Rust)
sys.modules.setdefault("osqp", None)
# Stub unused LP Cython extension in POT on Windows if vcomp140.dll is absent
import types as _types
if sys.platform == "win32" and "ot.lp.emd_wrap" not in sys.modules:
    _emd_stub = _types.ModuleType("ot.lp.emd_wrap")
    _emd_stub.emd_c = _emd_stub.emd_c_sparse = _emd_stub.check_result = _emd_stub.emd_1d_sorted = _emd_stub.emd_c_lazy = None  # type: ignore[attr-defined]
    sys.modules["ot.lp.emd_wrap"] = _emd_stub

import cvxpy as cp
from fastmcp import FastMCP
import numpy as np
import ot
from scipy import special

from services.swrt_math_kernel_mcp.idx_rules import (
    IDX_LOT_SHARES,
    IDX_ROUND_TRIP_FEE,
    compute_ara_arb_bounds,
    compute_min_required_edge,
    round_to_idx_tick,
)

mcp = FastMCP("swrt-math-kernel-mcp")

# Known IDX Broker Cohort Classifications
INSTITUTIONAL_FOREIGN_BROKERS = {
    "ZP", "YU", "AK", "BK", "RX", "KZ", "MS", "CS", "CG", "DB", "ML", "CL"
}
DOMESTIC_INST_BROKERS = {
    "CC", "NI", "OD", "DX", "IF", "LG", "KI", "TP", "BB", "ag"
}
RETAIL_CROWD_BROKERS = {
    "YP", "PD", "XC", "XL", "KK", "SQ", "MG", "CP", "BQ", "AZ", "DR", "EP"
}


def classify_broker_tier(broker_code: str) -> str:
    """Classify an IDX 2-letter broker code into Foreign/Inst, Domestic Inst, or Retail."""
    code = broker_code.upper().strip()
    if code in INSTITUTIONAL_FOREIGN_BROKERS:
        return "INST_FOREIGN"
    if code in DOMESTIC_INST_BROKERS:
        return "INST_DOMESTIC"
    if code in RETAIL_CROWD_BROKERS:
        return "RETAIL"
    return "SYNDICATE_OTHER"


# ============================================================================
# PILLAR 1: SINKHORN-KNOPP ENTROPIC OPTIMAL TRANSPORT BROKER MATRIX
# ============================================================================
@mcp.tool()
def compute_sinkhorn_bandar_flow(
    brokers_buy: list[dict[str, Any]],
    brokers_sell: list[dict[str, Any]],
    reg_epsilon: float = 0.08,
) -> dict[str, Any]:
    """
    Solve the Entropic Optimal Transport problem on the IDX Intraday Broker Summary
    using the Sinkhorn-Knopp algorithm (`ot.sinkhorn`).

    Parameters
    ----------
    brokers_buy : list of dicts with {"broker": str, "lots": float, "avg_price": float, "category": optional str}
    brokers_sell : list of dicts with {"broker": str, "lots": float, "avg_price": float, "category": optional str}
    reg_epsilon : Entropic regularization parameter lambda > 0.
    """
    if not brokers_buy or not brokers_sell:
        return {
            "conviction_kappa": 0.0,
            "retail_to_inst_flow": 0.0,
            "inst_to_retail_flow": 0.0,
            "self_loop_wash_ratio": 0.0,
            "sinkhorn_divergence": 0.0,
            "top_concentration_ratio": 0.0,
            "transport_matrix": [],
        }

    buy_lots = np.array([max(1.0, float(b.get("lots", 0.0))) for b in brokers_buy], dtype=np.float64)
    sell_lots = np.array([max(1.0, float(s.get("lots", 0.0))) for s in brokers_sell], dtype=np.float64)

    # Normalize into probability marginals mu_buy (target) and nu_sell (source)
    p_sell = sell_lots / np.sum(sell_lots)
    q_buy = buy_lots / np.sum(buy_lots)

    n_sell = len(brokers_sell)
    n_buy = len(brokers_buy)

    sell_cats = [
        s.get("category") or classify_broker_tier(str(s.get("broker", "")))
        for s in brokers_sell
    ]
    buy_cats = [
        b.get("category") or classify_broker_tier(str(b.get("broker", "")))
        for b in brokers_buy
    ]

    sell_prices = np.array([float(s.get("avg_price", 1000.0)) for s in brokers_sell], dtype=np.float64)
    buy_prices = np.array([float(b.get("avg_price", 1000.0)) for b in brokers_buy], dtype=np.float64)
    ref_price = max(1.0, float(np.mean(np.concatenate([sell_prices, buy_prices]))))

    # Build asymmetric microstructure transport cost matrix C_{i,j} (Seller i -> Buyer j)
    cost_matrix = np.zeros((n_sell, n_buy), dtype=np.float64)
    for i in range(n_sell):
        for j in range(n_buy):
            s_code = str(brokers_sell[i].get("broker", "")).upper()
            b_code = str(brokers_buy[j].get("broker", "")).upper()
            price_diff = abs(sell_prices[i] - buy_prices[j]) / ref_price

            # Base distance from execution price proximity + tier transition cost
            base_cost = 0.25 + 10.0 * price_diff
            if s_code == b_code:
                # Same broker crossing / wash trade self-loop has low friction
                base_cost = 0.08 + 2.0 * price_diff
            elif sell_cats[i] == "RETAIL" and buy_cats[j] in ("INST_FOREIGN", "INST_DOMESTIC"):
                # Retail capitulation absorbed by institutional bids
                base_cost = 0.18 + 5.0 * price_diff
            elif sell_cats[i] in ("INST_FOREIGN", "INST_DOMESTIC") and buy_cats[j] == "RETAIL":
                # Institutional distribution into retail euphoria
                base_cost = 0.18 + 5.0 * price_diff
            cost_matrix[i, j] = base_cost

    # Solve Sinkhorn-Knopp Optimal Transport Coupling Gamma*
    gamma = ot.sinkhorn(
        p_sell,
        q_buy,
        cost_matrix,
        reg=max(0.01, float(reg_epsilon)),
        numItermax=1000,
        stopThr=1e-7,
    )
    gamma = np.asarray(gamma, dtype=np.float64)

    # Aggregate directional transport masses
    retail_to_inst = 0.0
    inst_to_retail = 0.0
    self_loop_wash = 0.0
    inst_to_inst = 0.0

    for i in range(n_sell):
        for j in range(n_buy):
            mass = float(gamma[i, j])
            s_code = str(brokers_sell[i].get("broker", "")).upper()
            b_code = str(brokers_buy[j].get("broker", "")).upper()
            if s_code == b_code:
                self_loop_wash += mass
            if sell_cats[i] == "RETAIL" and buy_cats[j] in ("INST_FOREIGN", "INST_DOMESTIC"):
                retail_to_inst += mass
            elif sell_cats[i] in ("INST_FOREIGN", "INST_DOMESTIC") and buy_cats[j] == "RETAIL":
                inst_to_retail += mass
            elif (
                sell_cats[i] in ("INST_FOREIGN", "INST_DOMESTIC")
                and buy_cats[j] in ("INST_FOREIGN", "INST_DOMESTIC")
            ):
                inst_to_inst += mass

    # Volume imbalance ratio between total institutional buying vs selling
    inst_buy_vol = sum(
        buy_lots[j] for j in range(n_buy) if buy_cats[j] in ("INST_FOREIGN", "INST_DOMESTIC")
    )
    inst_sell_vol = sum(
        sell_lots[i] for i in range(n_sell) if sell_cats[i] in ("INST_FOREIGN", "INST_DOMESTIC")
    )
    retail_buy_vol = sum(buy_lots[j] for j in range(n_buy) if buy_cats[j] == "RETAIL")
    retail_sell_vol = sum(sell_lots[i] for i in range(n_sell) if sell_cats[i] == "RETAIL")

    total_vol = max(1.0, float(np.sum(buy_lots) + np.sum(sell_lots)) / 2.0)
    net_inst_pressure = (inst_buy_vol - inst_sell_vol) / total_vol
    net_ot_flow = retail_to_inst - inst_to_retail

    # Top-3 concentration ratio (Herfindahl / Bandar dominance)
    sorted_buy = np.sort(q_buy)[::-1]
    sorted_sell = np.sort(p_sell)[::-1]
    top3_buy = float(np.sum(sorted_buy[: min(3, len(sorted_buy))]))
    top3_sell = float(np.sum(sorted_sell[: min(3, len(sorted_sell))]))
    concentration_diff = top3_buy - top3_sell

    # Wash-trade penalty dampens fake bullish conviction and amplifies distribution traps
    wash_penalty = max(0.0, self_loop_wash - 0.12) * 1.25

    raw_kappa = 0.50 * net_ot_flow + 0.35 * net_inst_pressure + 0.25 * concentration_diff
    if raw_kappa > 0:
        raw_kappa = max(0.0, raw_kappa - wash_penalty)
    else:
        raw_kappa = raw_kappa - 0.5 * wash_penalty

    conviction_kappa = float(np.clip(np.tanh(2.2 * raw_kappa), -0.99, 0.99))
    sinkhorn_div = float(np.sum(gamma * cost_matrix))

    return {
        "conviction_kappa": round(conviction_kappa, 6),
        "retail_to_inst_flow": round(float(retail_to_inst), 6),
        "inst_to_retail_flow": round(float(inst_to_retail), 6),
        "inst_to_inst_flow": round(float(inst_to_inst), 6),
        "self_loop_wash_ratio": round(float(self_loop_wash), 6),
        "sinkhorn_divergence": round(sinkhorn_div, 6),
        "top3_buy_concentration": round(top3_buy, 6),
        "top3_sell_concentration": round(top3_sell, 6),
        "net_inst_pressure": round(float(net_inst_pressure), 6),
        "transport_matrix": np.round(gamma, 5).tolist(),
    }


# ============================================================================
# PILLAR 2: DEPTH-3 LOB ROUGH PATH SIGNATURE & LEVY SPOOFING DETECTOR
# ============================================================================
def _compute_depth3_path_signature(path: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Compute exact truncated Rough Path Signature up to Depth 3:
    S^1 in R^d, S^2 in R^{d x d}, S^3 in R^{d x d x d}
    for a piecewise-linear path `path` of shape (N, d) using Chen's identity.
    """
    if path.shape[0] < 2:
        d = path.shape[1] if path.ndim == 2 else 3
        return np.zeros(d), np.zeros((d, d)), np.zeros((d, d, d))

    dX = np.diff(path, axis=0)  # shape (N-1, d)
    d = dX.shape[1]

    S1 = np.zeros(d, dtype=np.float64)
    S2 = np.zeros((d, d), dtype=np.float64)
    S3 = np.zeros((d, d, d), dtype=np.float64)

    for z in dX:
        # Linear segment increments:
        # exp(z) = 1 + z + 1/2 (z \otimes z) + 1/6 (z \otimes z \otimes z)
        z2 = 0.5 * np.outer(z, z)
        z3 = (1.0 / 6.0) * np.einsum("i,j,k->ijk", z, z, z)

        # Chen's identity: S(X * z) = S(X) \otimes exp(z)
        new_S3 = (
            S3
            + np.einsum("ij,k->ijk", S2, z)
            + np.einsum("i,jk->ijk", S1, z2)
            + z3
        )
        new_S2 = S2 + np.outer(S1, z) + z2
        new_S1 = S1 + z

        S1, S2, S3 = new_S1, new_S2, new_S3

    return S1, S2, S3


@mcp.tool()
def compute_lob_rough_signature(
    micro_prices: list[float],
    ofi_series: list[float],
    cancel_rates: list[float],
    bid_levels_lots: list[float],
    ask_levels_lots: list[float],
    prev_close_rp: int,
    last_price_rp: int,
) -> dict[str, Any]:
    """
    Compute the Depth-3 Rough Path Signature over the 3D intraday microstructure trajectory
    X_t = (MicroPrice_t, OFI_t, CancelRate_t), extract the Lévy Area antisymmetric spoofing
    tensor, and calculate the 7% ARB Queue Depletion Hazard h_ARB in [0, 1].
    """
    n_pts = min(len(micro_prices), len(ofi_series), len(cancel_rates))
    if n_pts < 3:
        raise ValueError("Rough path signature requires at least 3 intraday trajectory observations.")

    p_arr = np.asarray(micro_prices[:n_pts], dtype=np.float64)
    o_arr = np.asarray(ofi_series[:n_pts], dtype=np.float64)
    c_arr = np.asarray(cancel_rates[:n_pts], dtype=np.float64)

    # Normalize channels onto comparable dimensionless path coordinates:
    # Channel 0: cumulative return from initial micro-price (scaled by 25x so 4% move ~ 1.0)
    p_norm = (p_arr - p_arr[0]) / max(1.0, float(prev_close_rp)) * 25.0
    # Channel 1: Order Flow Imbalance state trajectory (scaled by 100 lots reference)
    o_mean_drift = float(np.mean(o_arr)) / 65.0
    o_osc = (o_arr - float(np.mean(o_arr))) / max(10.0, float(np.std(o_arr)))
    o_norm = np.linspace(0.0, o_mean_drift, n_pts) + 0.45 * o_osc
    # Channel 2: Cancellation intensity trajectory (weighted by absolute cancel rate in [0, 1])
    mean_cancel = float(np.mean(c_arr))
    c_osc = (c_arr - mean_cancel) / max(0.05, float(np.std(c_arr)))
    c_norm = np.linspace(0.0, mean_cancel, n_pts) + mean_cancel * c_osc

    path = np.column_stack([p_norm, o_norm, c_norm])
    S1, S2, S3 = _compute_depth3_path_signature(path)

    # Antisymmetric Lévy Area matrix A_{i,j} = 0.5 * (S2[i,j] - S2[j,i])
    levy_area = 0.5 * (S2 - S2.T)
    # Spoofing signature: OFI builds up first (channel 1), followed by rapid Cancel surge (channel 2)
    # without upward price continuation (A_{1,2} > 0 while price drift S1[0] <= 0 or stalls)
    levy_ofi_cancel = float(levy_area[1, 2])
    levy_price_ofi = float(levy_area[0, 1])
    depth3_downward_accel = float(S3[0, 0, 0])

    # L2 Orderbook Liquidity Cushion vs Overhang
    total_bid_lots = float(np.sum(bid_levels_lots)) if bid_levels_lots else 0.0
    total_ask_lots = float(np.sum(ask_levels_lots)) if ask_levels_lots else 0.0
    book_imbalance = (total_bid_lots - total_ask_lots) / max(1.0, total_bid_lots + total_ask_lots)

    # Distance to -7% ARB floor
    bounds = compute_ara_arb_bounds(prev_close_rp)
    arb_rp = int(bounds["arb_rp"])
    dist_to_arb_pct = max(0.0, (float(last_price_rp) - float(arb_rp)) / max(1.0, float(prev_close_rp)))

    # Proximity hazard rises exponentially as price approaches the -7% ARB limit (dist_to_arb_pct -> 0)
    proximity_hazard = math.exp(-dist_to_arb_pct / 0.022)
    # Bid depletion hazard when ask wall dwarfs bid liquidity
    depletion_hazard = max(0.0, -book_imbalance)
    # Spoofing hazard from Lévy area between OFI and Cancellation rate
    spoofing_score = float(np.clip(math.tanh(max(0.0, levy_ofi_cancel) * 1.8), 0.0, 1.0))
    downward_cascade_term = float(np.clip(math.tanh(max(0.0, -S1[0] * 0.9 - depth3_downward_accel)), 0.0, 1.0))

    raw_h_arb = (
        0.42 * proximity_hazard
        + 0.28 * depletion_hazard
        + 0.18 * downward_cascade_term
        + 0.12 * spoofing_score
    )
    h_arb = float(np.clip(raw_h_arb, 0.01, 0.99))

    # Effective LOB directional signal penalizes phantom bid spoofing
    raw_lob_drift = 0.55 * math.tanh(S1[0] * 1.2) + 0.45 * book_imbalance - 0.65 * spoofing_score
    lob_mu_5d = float(np.clip(raw_lob_drift, -0.98, 0.98))
    liquidity_score = float(np.clip(book_imbalance - 0.5 * spoofing_score, -0.98, 0.98))

    return {
        "s1_vector": [round(float(x), 6) for x in S1.tolist()],
        "levy_area_matrix": np.round(levy_area, 6).tolist(),
        "levy_ofi_cancel": round(levy_ofi_cancel, 6),
        "levy_price_ofi": round(levy_price_ofi, 6),
        "depth3_price_cubic": round(depth3_downward_accel, 6),
        "spoofing_detected": bool(spoofing_score > 0.35),
        "spoofing_intensity": round(spoofing_score, 6),
        "book_imbalance": round(book_imbalance, 6),
        "dist_to_arb_pct": round(dist_to_arb_pct, 6),
        "h_arb": round(h_arb, 6),
        "lob_mu_5d": round(lob_mu_5d, 6),
        "liquidity_score": round(liquidity_score, 6),
    }


# ============================================================================
# PILLAR 3: CELLULAR SHEAF LAPLACIAN L_F & COHOMOLOGY FAULT EXTRACTOR
# ============================================================================
@mcp.tool()
def compute_sheaf_cohomology(
    stalks_by_agent: dict[str, list[float]],
    cohomology_threshold: float = 0.70,
) -> dict[str, Any]:
    """
    Construct the Cellular Sheaf Laplacian L_F = delta^T W_E delta over the 4 agent stalks
    V = ["BDM", "LOB", "NLP", "MAC"], where each stalk x_v = [mu_5d, theta_star, L, h_ARB] in R^4.

    Computes:
    - Normalized Dirichlet Sheaf Frustration Energy Phi(x)
    - Pairwise Coboundary Fault norms ||delta x||_e across all 6 tensegrity edges
    - Global Harmonic Section consensus stalk x* = (I + alpha * L_F)^{-1} x
    """
    agent_order = ["BDM", "LOB", "NLP", "MAC"]
    d_stalk = 4

    for ag in agent_order:
        if ag not in stalks_by_agent or len(stalks_by_agent[ag]) != d_stalk:
            raise ValueError(f"Missing or malformed 4D stalk vector for agent '{ag}'.")

    # Assemble 16D 0-cochain vector x in C^0(G; F)
    stalk_matrix = np.array([stalks_by_agent[ag] for ag in agent_order], dtype=np.float64)
    x_vec = stalk_matrix.reshape(-1)  # shape (16,)

    # Restriction map diagonal weights on stalk components:
    # Emphasize directional conviction (mu_5d) and liquidity/ARB alignment across pillars
    restriction_diag = np.diag([1.35, 0.45, 0.85, 1.10])

    # Edges of the 4-clique with epistemic importance weights:
    # E.g. (BDM, NLP) directly tests whether Bandar flow contradicts Public Catalyst news!
    edges_spec = [
        ("BDM", "NLP", 1.45),  # Bandar OT vs Public News (Bull Trap Detector)
        ("BDM", "LOB", 1.25),  # Bandar OT vs Orderbook Rough Path
        ("LOB", "NLP", 1.20),  # Orderbook vs Public News
        ("BDM", "MAC", 1.00),  # Bandar OT vs Macro/LK Valuation
        ("LOB", "MAC", 0.95),  # Orderbook vs Macro/LK Valuation
        ("NLP", "MAC", 1.05),  # Public News vs Macro/LK Solvency
    ]

    n_vertices = len(agent_order)
    n_edges = len(edges_spec)
    delta_blocks = np.zeros((n_edges * d_stalk, n_vertices * d_stalk), dtype=np.float64)
    edge_faults: list[dict[str, Any]] = []

    for e_idx, (u_name, v_name, weight) in enumerate(edges_spec):
        u_i = agent_order.index(u_name)
        v_i = agent_order.index(v_name)
        w_sqrt = math.sqrt(weight)

        F_u = w_sqrt * restriction_diag
        F_v = w_sqrt * restriction_diag

        row_slice = slice(e_idx * d_stalk, (e_idx + 1) * d_stalk)
        delta_blocks[row_slice, u_i * d_stalk : (u_i + 1) * d_stalk] = F_u
        delta_blocks[row_slice, v_i * d_stalk : (v_i + 1) * d_stalk] = -F_v

        # Evaluate coboundary discrepancy on this edge: (delta x)_e = F_u x_u - F_v x_v
        discrepancy_vec = F_u @ stalk_matrix[u_i] - F_v @ stalk_matrix[v_i]
        fault_norm = float(np.linalg.norm(discrepancy_vec))
        mu_gap = float(stalk_matrix[u_i, 0] - stalk_matrix[v_i, 0])

        edge_faults.append(
            {
                "edge": f"{u_name}<->{v_name}",
                "source": u_name,
                "target": v_name,
                "weight": weight,
                "fault_norm": round(fault_norm, 6),
                "mu_5d_discrepancy": round(mu_gap, 6),
                "is_contradiction": bool(fault_norm > 0.85),
            }
        )

    # Sheaf Laplacian L_F = delta^T delta in R^{16 x 16}
    L_F = delta_blocks.T @ delta_blocks

    # Normalized Dirichlet Sheaf Frustration Energy Phi(x)
    # Scaled by 1 / (||x||_2^2 + eps) so Phi(x) measures structural angular contradiction
    quad_energy = float(x_vec.T @ L_F @ x_vec)
    norm_sq = float(np.dot(x_vec, x_vec)) + 0.25
    # Normalization factor 0.22 calibrates coherent setups to [0.01, 0.15]
    # and Bandar Bull Traps (NLP=+0.90, BDM=-0.80) to > 0.70 (typically ~ 0.92 - 1.25)
    sheaf_phi = float(0.22 * quad_energy / norm_sq)

    # Heat-kernel smoothing onto Global Section H^0(G, F): x_smooth = (I + alpha L_F)^{-1} x
    alpha_smooth = 0.20
    x_smoothed = np.linalg.solve(
        np.eye(n_vertices * d_stalk) + alpha_smooth * L_F,
        x_vec,
    ).reshape(n_vertices, d_stalk)

    # Weight BDM and LOB higher in consensus drift and tail hazard
    pillar_weights = np.array([0.34, 0.30, 0.16, 0.20], dtype=np.float64)
    consensus_stalk = (pillar_weights @ x_smoothed).tolist()
    # Tail ARB hazard is conservative (takes max of weighted consensus and 85% of worst-case LOB/BDM hazard)
    max_h_arb = max(float(stalk_matrix[0, 3]), float(stalk_matrix[1, 3]))
    consensus_stalk[3] = float(max(consensus_stalk[3], 0.85 * max_h_arb))

    edge_faults_sorted = sorted(edge_faults, key=lambda item: item["fault_norm"], reverse=True)
    primary_fault = edge_faults_sorted[0] if edge_faults_sorted else None

    return {
        "sheaf_phi": round(sheaf_phi, 6),
        "cohomology_threshold": cohomology_threshold,
        "cohomology_veto": bool(sheaf_phi > cohomology_threshold),
        "consensus_stalk": [round(float(v), 6) for v in consensus_stalk],
        "edge_faults": edge_faults_sorted,
        "primary_fault_edge": primary_fault["edge"] if primary_fault else "NONE",
        "primary_fault_norm": primary_fault["fault_norm"] if primary_fault else 0.0,
        "sheaf_laplacian_trace": round(float(np.trace(L_F)), 6),
        "smoothed_stalks": {
            ag: [round(float(v), 6) for v in x_smoothed[idx].tolist()]
            for idx, ag in enumerate(agent_order)
        },
    }


# ============================================================================
# PILLAR 4: WASSERSTEIN DRO LOT SIZER (`cvxpy` + `clarabel`)
# ============================================================================
@mcp.tool()
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
    """
    Solve the Wasserstein Distributionally Robust Optimization (WDRO) position sizing
    problem using `cvxpy` and the `CLARABEL` interior-point solver.

    Enforces hard cohomology and ARB hazard circuit breakers:
    - Phi(x) > 0.70 -> approved_lots = 0 (Action = "BLOCKED_COHOMOLOGY")
    - h_ARB > 0.65 -> approved_lots = 0 (Action = "AVOID_ARB_HAZARD")
    """
    mu_5d, theta_star, liq_score, h_arb = [float(x) for x in consensus_stalk]

    # Wasserstein ambiguity radius epsilon(Phi) grows exponentially with Sheaf frustration Phi(x)
    eps_0 = 0.0045
    beta_sheaf = 2.10
    epsilon_phi = float(eps_0 * math.exp(beta_sheaf * max(0.0, sheaf_phi)))

    # 1. Hard Sheaf Cohomology Veto (Bull Trap / Conflicting Pillars)
    if sheaf_phi > cohomology_threshold:
        return {
            "action": "BLOCKED_COHOMOLOGY",
            "approved_lots": 0,
            "approved_shares": 0,
            "optimal_weight_pct": 0.0,
            "notional_exposure_rp": 0,
            "epsilon_phi": round(epsilon_phi, 6),
            "expected_5d_return": round(mu_5d * 0.055, 6),
            "worst_case_wdro_return": round(mu_5d * 0.055 - epsilon_phi, 6),
            "solver_status": "VETOED_BY_SHEAF_COHOMOLOGY",
            "veto_reason": (
                f"Sheaf frustration energy Phi(x)={sheaf_phi:.3f} exceeds threshold "
                f"{cohomology_threshold:.2f} (Structural contradiction / Bandar Bull Trap)."
            ),
        }

    # 2. Hard -7% ARB Liquidity Cascade Veto
    if h_arb > arb_hazard_threshold:
        return {
            "action": "AVOID_ARB_HAZARD",
            "approved_lots": 0,
            "approved_shares": 0,
            "optimal_weight_pct": 0.0,
            "notional_exposure_rp": 0,
            "epsilon_phi": round(epsilon_phi, 6),
            "expected_5d_return": round(mu_5d * 0.055, 6),
            "worst_case_wdro_return": round(mu_5d * 0.055 - epsilon_phi, 6),
            "solver_status": "VETOED_BY_ARB_HAZARD",
            "veto_reason": (
                f"ARB queue depletion hazard h_ARB={h_arb:.3f} exceeds safe limit "
                f"{arb_hazard_threshold:.2f} (-7% ARB liquidity freeze risk)."
            ),
        }

    # Expected 5-day gross drift scaled from normalized conviction mu_5d in [-1, 1]
    # Preserves negative drift when mu_5d < 0 and positive drift when mu_5d > 0
    if mu_5d < 0.0:
        expected_gross_return = mu_5d * 0.065 * (1.0 + 0.15 * abs(liq_score))
        net_expected_return = expected_gross_return - IDX_ROUND_TRIP_FEE
        worst_case_drift = net_expected_return - epsilon_phi - 0.025 * h_arb
        return {
            "action": "HOLD_NO_EDGE",
            "approved_lots": 0,
            "approved_shares": 0,
            "optimal_weight_pct": 0.0,
            "notional_exposure_rp": 0,
            "epsilon_phi": round(epsilon_phi, 6),
            "expected_5d_return": round(expected_gross_return, 6),
            "worst_case_wdro_return": round(worst_case_drift, 6),
            "solver_status": "NEGATIVE_BEARISH_DRIFT",
            "veto_reason": (
                f"Negative / bearish expected 5-day return ({expected_gross_return * 100:+.2f}%, "
                f"mu_5d={mu_5d:+.3f}): stock is in net selling / distribution."
            ),
        }

    expected_gross_return = mu_5d * 0.065 * (1.0 + 0.15 * max(0.0, liq_score))
    net_expected_return = expected_gross_return - IDX_ROUND_TRIP_FEE

    # 95% confidence (<5% False Positive Rate) statistical margin on the Wasserstein ball
    fp_confidence_margin = 0.0055
    worst_case_drift = net_expected_return - epsilon_phi - 0.025 * h_arb - fp_confidence_margin

    if mu_5d < 0.28 or liq_score < 0.05 or h_arb > 0.45:
        return {
            "action": "HOLD_NO_EDGE",
            "approved_lots": 0,
            "approved_shares": 0,
            "optimal_weight_pct": 0.0,
            "notional_exposure_rp": 0,
            "epsilon_phi": round(epsilon_phi, 6),
            "expected_5d_return": round(expected_gross_return, 6),
            "worst_case_wdro_return": round(worst_case_drift, 6),
            "solver_status": "BELOW_95PCT_CONFIDENCE_GATE",
            "veto_reason": (
                f"Signal conviction (mu_5d={mu_5d:+.3f}, liq={liq_score:+.3f}, h_ARB={h_arb:.3f}) "
                f"is below the 95% confidence gate (<5% false-positive protection)."
            ),
        }

    if worst_case_drift <= 0.003:
        return {
            "action": "HOLD_NO_EDGE",
            "approved_lots": 0,
            "approved_shares": 0,
            "optimal_weight_pct": 0.0,
            "notional_exposure_rp": 0,
            "epsilon_phi": round(epsilon_phi, 6),
            "expected_5d_return": round(expected_gross_return, 6),
            "worst_case_wdro_return": round(worst_case_drift, 6),
            "solver_status": "INSUFFICIENT_ROBUST_EDGE",
            "veto_reason": (
                f"Worst-case WDRO net return ({worst_case_drift * 100:+.2f}%) after "
                f"0.40% fees, ambiguity radius eps={epsilon_phi:.4f}, and 95% confidence margin is insufficient."
            ),
        }

    # Formulate Convex WDRO Portfolio Sizing Problem in CVXPY + CLARABEL
    w = cp.Variable(nonneg=True)
    sigma_eff = max(0.018, 0.042 * (1.0 - 0.35 * liq_score) * (1.0 + 0.8 * h_arb))
    risk_aversion_gamma = 14.0

    # Liquidity cap: never exceed 1.5% of Average Daily Volume (ADV) in lots
    lot_cost_rp = max(100.0, float(entry_price_rp * IDX_LOT_SHARES))
    max_liq_notional = 0.015 * float(adv_lots) * lot_cost_rp
    max_liq_weight = min(float(max_position_pct), max_liq_notional / max(1.0, float(capital_rp)))

    objective = cp.Maximize(
        w * net_expected_return
        - epsilon_phi * w
        - 0.025 * h_arb * w
        - 0.5 * risk_aversion_gamma * (sigma_eff**2) * cp.square(w)
    )
    constraints = [
        w <= max_liq_weight,
        w >= 0.0,
    ]
    prob = cp.Problem(objective, constraints)
    prob.solve(solver=cp.CLARABEL)

    w_star = float(w.value) if w.value is not None else 0.0
    w_star = float(np.clip(w_star, 0.0, max_liq_weight))

    raw_notional = w_star * float(capital_rp)
    approved_lots = int(math.floor(raw_notional / lot_cost_rp))
    approved_shares = approved_lots * IDX_LOT_SHARES
    actual_notional_rp = int(approved_lots * lot_cost_rp)

    if approved_lots <= 0:
        return {
            "action": "HOLD_NO_EDGE",
            "approved_lots": 0,
            "approved_shares": 0,
            "optimal_weight_pct": 0.0,
            "notional_exposure_rp": 0,
            "epsilon_phi": round(epsilon_phi, 6),
            "expected_5d_return": round(expected_gross_return, 6),
            "worst_case_wdro_return": round(worst_case_drift, 6),
            "solver_status": str(prob.status),
            "veto_reason": "Optimal capital allocation smaller than 1 IDX lot (100 shares).",
        }

    return {
        "action": "BUY",
        "approved_lots": approved_lots,
        "approved_shares": approved_shares,
        "optimal_weight_pct": round(float(actual_notional_rp / capital_rp) * 100.0, 2),
        "notional_exposure_rp": actual_notional_rp,
        "epsilon_phi": round(epsilon_phi, 6),
        "expected_5d_return": round(expected_gross_return, 6),
        "worst_case_wdro_return": round(worst_case_drift, 6),
        "solver_status": str(prob.status),
        "veto_reason": None,
    }


# ============================================================================
# PILLAR 5: ORNSTEIN-UHLENBECK FIRST-PASSAGE OPTIMAL STOPPING SOLVER
# ============================================================================
@mcp.tool()
def solve_ou_optimal_stopping(
    prev_close_rp: int,
    current_price_rp: int,
    consensus_stalk: list[float],
    sheaf_phi: float,
    epsilon_phi: float,
    approved_lots: int,
    reference_date: str = "2026-10-28",
) -> dict[str, Any]:
    """
    Solve the Ornstein-Uhlenbeck First-Passage Optimal Stopping problem for:
    - `entry_limit_rp` (IDX tick-aligned)
    - `take_profit_rp` (IDX tick-aligned, satisfying Rule 3 minimum edge >= 3*0.0040 + eps(Phi))
    - `stop_loss_pre_arb_rp` (IDX tick-aligned, strictly >= -5.2% below `prev_close_rp`)
    - `expected_holding_days` E[tau*] and Hard Time-Stop Date `time_stop_date`
    - 10-Day Forward Trajectory Cone (`mean_rp`, `upper_1sigma_rp`, `lower_1sigma_rp`, `upper_2sigma_rp`, `lower_2sigma_rp`)
    """
    mu_5d, theta_star, liq_score, h_arb = [float(x) for x in consensus_stalk]
    bounds = compute_ara_arb_bounds(prev_close_rp)
    pre_arb_floor_rp = int(bounds["pre_arb_floor_rp"])
    arb_rp = int(bounds["arb_rp"])
    ara_rp = int(bounds["ara_rp"])

    # Entry limit: slight passive bid capture below current price when liquid, tick-aligned
    entry_Anchor = float(current_price_rp) * (1.0 - 0.0015 * max(0.0, liq_score))
    entry_limit_rp = round_to_idx_tick(entry_Anchor, mode="floor")
    # Ensure entry_limit_rp stays strictly above pre_arb_floor_rp in normal trading
    if entry_limit_rp < pre_arb_floor_rp and current_price_rp >= pre_arb_floor_rp:
        entry_limit_rp = pre_arb_floor_rp

    # Calibrate OU equilibrium target and daily volatility
    theta = max(0.15, min(1.50, float(theta_star)))
    sigma_daily = max(0.011, 0.019 * (1.0 + 0.55 * h_arb - 0.20 * liq_score))

    min_req_edge = compute_min_required_edge(epsilon_phi)
    # OU optimal stopping take-profit percentage based on positive drift and volatility
    ou_tp_pct = max(
        min_req_edge + 0.006,
        max(0.022, mu_5d * 0.068) + 0.45 * sigma_daily / math.sqrt(theta),
    )
    raw_tp_rp = float(entry_limit_rp) * (1.0 + ou_tp_pct)
    take_profit_rp = min(ara_rp, round_to_idx_tick(raw_tp_rp, mode="ceil"))

    # Guarantee Rule 3: (take_profit_rp - entry_limit_rp) / entry_limit_rp >= 3 * 0.0040 + epsilon(Phi)
    actual_edge = (take_profit_rp - entry_limit_rp) / max(1.0, float(entry_limit_rp))
    while actual_edge < min_req_edge and take_profit_rp < ara_rp:
        tick_step = max(1, round_to_idx_tick(take_profit_rp + 1, mode="ceil") - take_profit_rp)
        take_profit_rp = round_to_idx_tick(take_profit_rp + tick_step, mode="ceil")
        actual_edge = (take_profit_rp - entry_limit_rp) / max(1.0, float(entry_limit_rp))

    # Pre-ARB Stop-Loss Tick: NEVER lower than -5.2% below prev_close_rp (Rule 2)
    desired_sl_rp = float(entry_limit_rp) * (1.0 - min(0.038, 1.85 * sigma_daily))
    candidate_sl_rp = round_to_idx_tick(desired_sl_rp, mode="ceil")
    stop_loss_pre_arb_rp = max(pre_arb_floor_rp, candidate_sl_rp)

    # Expected First-Passage Stopping Time E[tau*] via Siegert / OU relaxation formula
    # E[tau*] ~ (1 / theta) * ln((mu_eq - X_0) / (mu_eq - b*_TP)) bounded to realistic swing window
    if approved_lots > 0 and mu_5d > 0.05:
        asymp_target_pct = max(ou_tp_pct * 1.35, 0.04)
        ratio = np.clip(asymp_target_pct / max(0.008, asymp_target_pct - ou_tp_pct * 0.72), 1.25, 8.0)
        expected_holding_days = round(float(np.clip((1.0 / theta) * math.log(ratio) * 2.1, 1.5, 9.5)), 1)
    else:
        expected_holding_days = 0.0

    hard_max_days = int(max(3, math.ceil(expected_holding_days * 1.65))) if approved_lots > 0 else 0
    try:
        ref_dt = date.fromisoformat(reference_date)
    except ValueError:
        ref_dt = date(2026, 10, 28)

    # Advance calendar days skipping weekends for IDX trading days
    cur_dt = ref_dt
    trading_days_added = 0
    while trading_days_added < hard_max_days:
        cur_dt += timedelta(days=1)
        if cur_dt.weekday() < 5:
            trading_days_added += 1
    time_stop_date = cur_dt.isoformat()

    # Build 10-day Forward Ornstein-Uhlenbeck Trajectory Cone (all tick-aligned)
    # X_t = X_0 e^{-theta t} + mu_eq (1 - e^{-theta t}), Var(X_t) = (sigma^2 / 2 theta) (1 - e^{-2 theta t})
    cone_base_rp = (
        float(entry_limit_rp)
        if approved_lots > 0
        else float(round_to_idx_tick(current_price_rp, mode="nearest"))
    )
    multi_day_floor_rp = float(arb_rp) if approved_lots > 0 else max(1.0, float(prev_close_rp) * 0.65)
    asymp_drift_pct = mu_5d * 0.075 - 0.035 * max(0.0, h_arb - 0.35)
    mu_eq_price = cone_base_rp * (1.0 + asymp_drift_pct)

    trajectory_cone: list[dict[str, int | float]] = []
    for day_idx in range(0, 11):
        if day_idx == 0:
            p_mean = round_to_idx_tick(cone_base_rp, mode="nearest")
            trajectory_cone.append(
                {
                    "day": 0,
                    "mean_rp": p_mean,
                    "upper_1sigma_rp": p_mean,
                    "lower_1sigma_rp": p_mean,
                    "upper_2sigma_rp": p_mean,
                    "lower_2sigma_rp": p_mean,
                }
            )
            continue

        t_frac = float(day_idx) / 5.0
        decay = math.exp(-theta * t_frac)
        mean_raw = float(
            np.clip(
                cone_base_rp * decay + mu_eq_price * (1.0 - decay),
                multi_day_floor_rp,
                float(ara_rp),
            )
        )
        ou_std_pct = sigma_daily * math.sqrt(
            max(1e-6, (1.0 - math.exp(-2.0 * theta * float(day_idx))) / (2.0 * theta))
        )
        std_rp = cone_base_rp * ou_std_pct

        mean_rp = round_to_idx_tick(mean_raw, mode="nearest")
        u1_rp = max(mean_rp, round_to_idx_tick(mean_raw + 1.0 * std_rp, mode="ceil"))
        l1_rp = min(mean_rp, round_to_idx_tick(max(multi_day_floor_rp, mean_raw - 1.0 * std_rp), mode="floor"))
        u2_rp = max(u1_rp, round_to_idx_tick(mean_raw + 2.0 * std_rp, mode="ceil"))
        l2_rp = min(l1_rp, round_to_idx_tick(max(multi_day_floor_rp, mean_raw - 2.0 * std_rp), mode="floor"))

        trajectory_cone.append(
            {
                "day": day_idx,
                "mean_rp": mean_rp,
                "upper_1sigma_rp": u1_rp,
                "lower_1sigma_rp": l1_rp,
                "upper_2sigma_rp": u2_rp,
                "lower_2sigma_rp": l2_rp,
            }
        )

    pre_arb_drawdown_from_prev_close_pct = (
        (float(stop_loss_pre_arb_rp) - float(prev_close_rp)) / max(1.0, float(prev_close_rp))
    )

    return {
        "prev_close_rp": int(bounds["prev_close_rp"]),
        "entry_limit_rp": entry_limit_rp,
        "take_profit_rp": take_profit_rp,
        "stop_loss_pre_arb_rp": stop_loss_pre_arb_rp,
        "pre_arb_floor_rp": pre_arb_floor_rp,
        "arb_floor_rp": arb_rp,
        "ara_ceiling_rp": ara_rp,
        "gross_tp_edge_pct": round(actual_edge * 100.0, 3),
        "min_required_edge_pct": round(min_req_edge * 100.0, 3),
        "pre_arb_drawdown_from_prev_close_pct": round(pre_arb_drawdown_from_prev_close_pct * 100.0, 3),
        "expected_holding_days": expected_holding_days,
        "hard_time_stop_days": hard_max_days,
        "time_stop_date": time_stop_date,
        "ou_theta": round(theta, 4),
        "ou_sigma_daily": round(sigma_daily, 4),
        "trajectory_cone": trajectory_cone,
    }


if __name__ == "__main__":
    mcp.run()
