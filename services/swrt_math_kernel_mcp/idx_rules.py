"""
IDX Microstructure & Regulatory Rules (Kep-00157/BEI/10-2026).

Enforces deterministic IDX Fraksi Harga tick rounding, asymmetric ARA/ARB bounds,
the -5.2% Pre-ARB stop-loss floor, and IDX lot/fee invariants.
"""

from __future__ import annotations
import math
from typing import Literal

IDX_LOT_SHARES: int = 100
IDX_BUY_FEE: float = 0.0015
IDX_SELL_FEE: float = 0.0025
IDX_ROUND_TRIP_FEE: float = IDX_BUY_FEE + IDX_SELL_FEE  # 0.0040 (0.40%)
PRE_ARB_MAX_DRAWDOWN_PCT: float = 0.052  # -5.2% hard circuit breaker before -7% ARB
ARB_LIMIT_PCT: float = 0.070  # -7.0% symmetric ARB across all tiers


def get_idx_tick_size(price_rp: float) -> int:
    """
    Return the IDX tick size (Fraksi Harga) in Rupiah for a given price:
    - Price < Rp200: tick = Rp1 (Floor = Rp1)
    - Rp200 <= Price < Rp500: tick = Rp2
    - Rp500 <= Price < Rp2,000: tick = Rp5
    - Rp2,000 <= Price < Rp5,000: tick = Rp10
    - Price >= Rp5,000: tick = Rp25
    """
    if price_rp < 200:
        return 1
    elif price_rp < 500:
        return 2
    elif price_rp < 2000:
        return 5
    elif price_rp < 5000:
        return 10
    else:
        return 25


def is_valid_idx_tick(price_rp: int) -> bool:
    """Verify whether an integer Rupiah price is aligned to its IDX tick tier."""
    if price_rp < 1:
        return False
    tick = get_idx_tick_size(price_rp)
    return (price_rp % tick) == 0


def round_to_idx_tick(
    price_rp: float,
    mode: Literal["nearest", "floor", "ceil"] = "nearest",
) -> int:
    """
    Round any Rupiah price to a valid IDX Fraksi Harga tick.
    Re-evaluates tick size if rounding crosses a tier boundary.
    """
    if price_rp <= 1.0:
        return 1

    tick = get_idx_tick_size(price_rp)
    if mode == "floor":
        rounded = int(math.floor((price_rp + 1e-9) / tick) * tick)
    elif mode == "ceil":
        rounded = int(math.ceil((price_rp - 1e-9) / tick) * tick)
    else:
        rounded = int(round(price_rp / tick) * tick)

    rounded = max(1, rounded)
    # Re-check tier boundary (e.g. 499.5 -> 500 where tick is 5, or 501 floored)
    new_tick = get_idx_tick_size(rounded)
    if rounded % new_tick != 0:
        if mode == "floor":
            rounded = int(math.floor(rounded / new_tick) * new_tick)
        elif mode == "ceil":
            rounded = int(math.ceil(rounded / new_tick) * new_tick)
        else:
            rounded = int(round(rounded / new_tick) * new_tick)

    return max(1, rounded)


def get_ara_pct(prev_close_rp: float) -> float:
    """
    Return Auto Rejection Atas (ARA) percentage per Kep-00157/BEI/10-2026:
    - Rp50 - Rp200: 35%
    - Rp200 - Rp5,000: 25%
    - > Rp5,000: 20%
    """
    if prev_close_rp <= 200:
        return 0.35
    elif prev_close_rp <= 5000:
        return 0.25
    else:
        return 0.20


def compute_ara_arb_bounds(prev_close_rp: int) -> dict[str, int | float]:
    """
    Compute exact tick-aligned ARA ceiling, ARB floor (-7%), and Pre-ARB stop-loss floor (-5.2%).
    `stop_loss_pre_arb_rp` must NEVER be lower than -5.2% below `prev_close_rp`.
    """
    prev_close = round_to_idx_tick(prev_close_rp, mode="nearest")
    ara_pct = get_ara_pct(prev_close)
    raw_ara = prev_close * (1.0 + ara_pct)
    raw_arb = prev_close * (1.0 - ARB_LIMIT_PCT)
    raw_pre_arb_floor = prev_close * (1.0 - PRE_ARB_MAX_DRAWDOWN_PCT)

    ara_rp = max(50, round_to_idx_tick(raw_ara, mode="floor"))
    arb_rp = max(50 if prev_close >= 50 else 1, round_to_idx_tick(raw_arb, mode="ceil"))
    # Strict ceil so stop_loss_pre_arb_rp is NEVER lower than -5.2% below prev_close_rp
    pre_arb_floor_rp = max(arb_rp, round_to_idx_tick(raw_pre_arb_floor, mode="ceil"))

    return {
        "prev_close_rp": prev_close,
        "ara_pct": ara_pct,
        "arb_pct": ARB_LIMIT_PCT,
        "ara_rp": ara_rp,
        "arb_rp": arb_rp,
        "pre_arb_floor_rp": pre_arb_floor_rp,
    }


def compute_min_required_edge(epsilon_phi: float) -> float:
    """
    Rule 3: Never recommend a position where
    (take_profit_rp - entry_limit_rp) / entry_limit_rp < 3 * 0.0040 + epsilon(Phi).
    """
    return 3.0 * IDX_ROUND_TRIP_FEE + max(0.0, float(epsilon_phi))
