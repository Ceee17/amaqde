"""
Pydantic v2 Schemas for the 5 Specialized Stalk Extractor Agents and the
1 Unified, Mathematically Proven Decision Card.
"""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field


class StalkVector4D(BaseModel):
    """
    Normalized 4D Stalk Vector x_v = [mu_5d, theta_star, liquidity_score, h_arb] in R^4
    attached to vertex v in {BDM, LOB, NLP, MAC} of the Cellular Sheaf.
    """

    agent_id: Literal["BDM", "LOB", "NLP", "MAC"]
    ticker: str
    mu_5d: float = Field(..., ge=-1.0, le=1.0, description="5-day directional drift conviction in [-1, 1]")
    theta_star: float = Field(..., gt=0.0, le=2.0, description="Ornstein-Uhlenbeck mean-reversion rate in (0, 2]")
    liquidity_score: float = Field(..., ge=-1.0, le=1.0, description="Normalized liquidity cushion in [-1, 1]")
    h_arb: float = Field(..., ge=0.0, le=1.0, description="-7% ARB queue depletion hazard in [0, 1]")
    summary_rationale: str = Field(default="")
    diagnostics: dict[str, Any] = Field(default_factory=dict)

    def to_vector(self) -> list[float]:
        """Return the ordered 4D numeric stalk [mu_5d, theta_star, L, h_ARB]."""
        return [
            float(self.mu_5d),
            float(self.theta_star),
            float(self.liquidity_score),
            float(self.h_arb),
        ]


class EdgeFaultSchema(BaseModel):
    """Pairwise coboundary discrepancy ||(delta x)_e||_2 on edge e = (u, v)."""

    edge: str
    source: str
    target: str
    weight: float
    fault_norm: float
    mu_5d_discrepancy: float
    is_contradiction: bool


class TrajectoryPointSchema(BaseModel):
    """Single day slice of the 10-day Forward Ornstein-Uhlenbeck Trajectory Cone."""

    day: int
    mean_rp: int
    upper_1sigma_rp: int
    lower_1sigma_rp: int
    upper_2sigma_rp: int
    lower_2sigma_rp: int


class UnifiedDecisionCard(BaseModel):
    """
    The 1 Unified, Mathematically Proven Decision Card output by `agent_exe_unifier.py`
    and cryptographically sealed by `merkle_audit_mcp`.
    """

    ticker: str
    regime: str
    action: Literal["BUY", "BLOCKED_COHOMOLOGY", "AVOID_ARB_HAZARD", "HOLD_NO_EDGE"]
    approved_lots: int = Field(..., ge=0)
    approved_shares: int = Field(..., ge=0)
    optimal_weight_pct: float = Field(..., ge=0.0)
    notional_exposure_rp: int = Field(..., ge=0)

    prev_close_rp: int
    last_price_rp: int
    entry_limit_rp: int
    take_profit_rp: int
    stop_loss_pre_arb_rp: int
    pre_arb_floor_rp: int
    arb_floor_rp: int
    ara_ceiling_rp: int

    gross_tp_edge_pct: float
    min_required_edge_pct: float
    pre_arb_drawdown_from_prev_close_pct: float
    expected_holding_days: float
    hard_time_stop_days: int
    time_stop_date: str

    sheaf_phi: float
    cohomology_threshold: float
    cohomology_veto: bool
    epsilon_phi: float
    h_arb: float
    primary_fault_edge: str
    primary_fault_norm: float
    veto_reason: str | None = None

    consensus_stalk: list[float]
    stalks: dict[str, StalkVector4D]
    edge_faults: list[EdgeFaultSchema]
    trajectory_cone: list[TrajectoryPointSchema]
    pillar_diagnostics: dict[str, Any] = Field(default_factory=dict)

    parquet_uri: str
    snapshot_sha256: str
    prev_merkle_hash: str
    receipt_sha256: str
    seq_id: int | None = None
    created_at_utc: str | None = None
