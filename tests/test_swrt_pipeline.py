"""
Automated Verification Suite (`tests/test_swrt_pipeline.py`) for the IDX SWRT Engine.

Verifies:
1. IDX Fraksi Harga tick rounding across all 5 price tiers & Kep-00157/BEI/10-2026 ARA/ARB rules.
2. Regime 1: Coherent Blue-Chip Accumulation (`BBCA`) -> Phi(x) low, BUY > 0 lots, tick-aligned
   Entry/TP/SL, Pre-ARB SL >= -5.2% below prev_close_rp, TP edge >= 3*0.0040 + eps(Phi),
   and verified DuckDB Merkle hash + zstd Parquet snapshot.
3. Regime 2: Bandar Bull Trap / Gorengan Pucuk (`BREN` & exact NLP=+0.90 vs BDM=-0.80 stalk test) ->
   Phi(x) > 0.70, pinpoints BDM<->NLP coboundary fault, and strictly forces `approved_lots == 0`.
4. Regime 3: -7% ARB Liquidity Cascade (`GOTO`) -> h_ARB > 0.65, forces `approved_lots == 0`
   (`AVOID_ARB_HAZARD`), and records an immutable forensic receipt in DuckDB.
5. Forensic Merkle Chain Integrity & Tamper Detection.
"""

from __future__ import annotations

from pathlib import Path
import pytest

from agents.agent_exe_unifier import DEFAULT_BOUND_AUTHZ_CODE, run_swrt_pipeline
from agents.schemas import StalkVector4D
from services.merkle_audit_mcp.server import verify_merkle_chain
from services.swrt_math_kernel_mcp.idx_rules import (
    IDX_ROUND_TRIP_FEE,
    PRE_ARB_MAX_DRAWDOWN_PCT,
    compute_ara_arb_bounds,
    get_idx_tick_size,
    is_valid_idx_tick,
    round_to_idx_tick,
)


def test_idx_tick_size_and_pre_arb_rules() -> None:
    """Verify Rule 1 (Fraksi Harga across all 5 tiers) and Rule 2 (-7% ARB & -5.2% Pre-ARB floor)."""
    # Tier 1: < Rp200 -> tick Rp1
    assert get_idx_tick_size(125) == 1
    assert round_to_idx_tick(125.4) == 125

    # Tier 2: Rp200 - Rp500 -> tick Rp2
    assert get_idx_tick_size(350) == 2
    assert round_to_idx_tick(351, mode="floor") == 350
    assert round_to_idx_tick(351, mode="ceil") == 352

    # Tier 3: Rp500 - Rp2,000 -> tick Rp5
    assert get_idx_tick_size(1250) == 5
    assert round_to_idx_tick(1253, mode="nearest") == 1255

    # Tier 4: Rp2,000 - Rp5,000 -> tick Rp10
    assert get_idx_tick_size(3420) == 10
    assert round_to_idx_tick(3424, mode="floor") == 3420

    # Tier 5: >= Rp5,000 -> tick Rp25
    assert get_idx_tick_size(9800) == 25
    assert round_to_idx_tick(9812, mode="ceil") == 9825

    # Verify Kep-00157/BEI/10-2026 ARA/ARB and -5.2% Pre-ARB floor
    for prev_close in (150, 380, 1450, 3600, 9800):
        bounds = compute_ara_arb_bounds(prev_close)
        pre_arb_floor = int(bounds["pre_arb_floor_rp"])
        arb_floor = int(bounds["arb_rp"])
        ara_ceil = int(bounds["ara_rp"])

        assert is_valid_idx_tick(pre_arb_floor)
        assert is_valid_idx_tick(arb_floor)
        assert is_valid_idx_tick(ara_ceil)
        # Pre-ARB floor must NEVER be lower than -5.2% below prev_close
        assert pre_arb_floor >= prev_close * (1.0 - PRE_ARB_MAX_DRAWDOWN_PCT) - 1e-6
        assert pre_arb_floor > arb_floor


def test_regime_1_coherent_blue_chip_accumulation(tmp_path: Path) -> None:
    """
    Verify Regime 1 (Coherent Blue-Chip Accumulation on BBCA):
    - Low Sheaf frustration energy Phi(x) < 0.70
    - Action == 'BUY' and approved_lots > 0
    - Entry, Take-Profit, and Pre-ARB Stop-Loss are strictly IDX-tick-aligned
    - Pre-ARB Stop-Loss is never lower than -5.2% below prev_close_rp
    - Gross Take-Profit edge >= 3 * 0.0040 + epsilon(Phi)
    - Valid DuckDB Merkle receipt & zstd Parquet snapshot created
    """
    vault_dir = str(tmp_path / "audit_vault")
    card = run_swrt_pipeline(
        ticker="BBCA",
        regime="COHERENT_ACCUMULATION",
        capital_rp=100_000_000.0,
        vault_dir=vault_dir,
    )

    assert card.ticker == "BBCA"
    assert card.action == "BUY"
    assert card.approved_lots > 0
    assert card.approved_shares == card.approved_lots * 100
    assert card.sheaf_phi < 0.25
    assert not card.cohomology_veto

    # Rule 1: Strict IDX Tick alignment
    assert is_valid_idx_tick(card.entry_limit_rp)
    assert is_valid_idx_tick(card.take_profit_rp)
    assert is_valid_idx_tick(card.stop_loss_pre_arb_rp)

    # Rule 2: Pre-ARB Stop-Loss never lower than -5.2% below prev_close_rp
    min_allowed_sl = card.prev_close_rp * (1.0 - PRE_ARB_MAX_DRAWDOWN_PCT)
    assert card.stop_loss_pre_arb_rp >= min_allowed_sl - 1e-6
    assert card.stop_loss_pre_arb_rp > card.arb_floor_rp

    # Rule 3: Minimum fee + Wasserstein ambiguity edge
    actual_edge = (card.take_profit_rp - card.entry_limit_rp) / card.entry_limit_rp
    required_edge = 3.0 * IDX_ROUND_TRIP_FEE + card.epsilon_phi
    assert actual_edge >= required_edge - 1e-6

    # Stopping horizon & trajectory cone
    assert card.expected_holding_days > 0.0
    assert len(card.trajectory_cone) == 11
    for pt in card.trajectory_cone:
        assert is_valid_idx_tick(pt.mean_rp)
        assert is_valid_idx_tick(pt.upper_1sigma_rp)
        assert is_valid_idx_tick(pt.lower_1sigma_rp)

    # Rule 4: Mandatory Merkle Audit Gate
    assert len(card.receipt_sha256) == 64
    assert len(card.snapshot_sha256) == 64
    assert Path(card.parquet_uri).exists()

    chain_status = verify_merkle_chain(vault_dir=vault_dir)
    assert chain_status["valid"] is True
    assert chain_status["total_receipts"] == 1
    assert chain_status["head_receipt_sha256"] == card.receipt_sha256


def test_regime_2_bandar_bull_trap_gorengan_pucuk(tmp_path: Path) -> None:
    """
    Verify Regime 2 (Bandar Bull Trap / Gorengan Pucuk on BREN):
    1. End-to-end JIT market bundle for BANDAR_BULL_TRAP produces Phi(x) > 0.70
       and forces `approved_lots == 0` (`BLOCKED_COHOMOLOGY`).
    2. Explicit SKILL.md verification: NLP = +0.90 vs BDM = -0.80 produces
       Phi(x) > 0.70 and forces `approved_lots == 0`.
    """
    vault_dir = str(tmp_path / "audit_vault")

    # 1. End-to-end synthetic regime test (BREN)
    card_bren = run_swrt_pipeline(
        ticker="BREN",
        regime="BANDAR_BULL_TRAP",
        capital_rp=100_000_000.0,
        vault_dir=vault_dir,
    )
    assert card_bren.stalks["NLP"].mu_5d > 0.80
    assert card_bren.stalks["BDM"].mu_5d < -0.60
    assert card_bren.sheaf_phi > 0.70
    assert card_bren.cohomology_veto is True
    assert card_bren.approved_lots == 0
    assert card_bren.action == "BLOCKED_COHOMOLOGY"
    assert "BDM" in card_bren.primary_fault_edge and "NLP" in card_bren.primary_fault_edge

    # 2. Exact SKILL.md specification test: NLP = +0.90, BDM = -0.80
    custom_stalks = {
        "BDM": StalkVector4D(
            agent_id="BDM",
            ticker="TRAP",
            mu_5d=-0.80,
            theta_star=0.75,
            liquidity_score=-0.65,
            h_arb=0.58,
            summary_rationale="Bandar heavy distribution (-0.80)",
        ),
        "LOB": StalkVector4D(
            agent_id="LOB",
            ticker="TRAP",
            mu_5d=-0.45,
            theta_star=0.50,
            liquidity_score=-0.40,
            h_arb=0.48,
            summary_rationale="LOB spoofing & ask reload",
        ),
        "NLP": StalkVector4D(
            agent_id="NLP",
            ticker="TRAP",
            mu_5d=0.90,
            theta_star=0.80,
            liquidity_score=0.70,
            h_arb=0.08,
            summary_rationale="Retail-facing euphoric headline (+0.90)",
        ),
        "MAC": StalkVector4D(
            agent_id="MAC",
            ticker="TRAP",
            mu_5d=-0.25,
            theta_star=0.40,
            liquidity_score=-0.20,
            h_arb=0.35,
            summary_rationale="Overextended valuation",
        ),
    }
    card_exact = run_swrt_pipeline(
        ticker="TRAP",
        regime="BANDAR_BULL_TRAP",
        vault_dir=vault_dir,
        stalk_overrides=custom_stalks,
    )
    assert card_exact.sheaf_phi > 0.70
    assert card_exact.approved_lots == 0
    assert card_exact.action == "BLOCKED_COHOMOLOGY"


def test_regime_3_arb_liquidity_cascade_and_merkle_tamper(tmp_path: Path) -> None:
    """
    Verify Regime 3 (-7% ARB Liquidity Cascade on GOTO) and verify that the
    DuckDB Merkle chain detects any byte tampering on frozen Parquet snapshots.
    """
    vault_dir = str(tmp_path / "audit_vault")

    card_goto = run_swrt_pipeline(
        ticker="GOTO",
        regime="ARB_LIQUIDITY_CASCADE",
        capital_rp=100_000_000.0,
        vault_dir=vault_dir,
    )

    assert card_goto.h_arb > 0.65
    assert card_goto.approved_lots == 0
    assert card_goto.action in ("AVOID_ARB_HAZARD", "BLOCKED_COHOMOLOGY")
    assert is_valid_idx_tick(card_goto.stop_loss_pre_arb_rp)
    assert card_goto.stop_loss_pre_arb_rp >= card_goto.prev_close_rp * (1.0 - PRE_ARB_MAX_DRAWDOWN_PCT) - 1e-6

    # Verify Merkle chain is valid before tampering
    check_ok = verify_merkle_chain(vault_dir=vault_dir)
    assert check_ok["valid"] is True

    # Simulate tampering with the frozen Parquet file on disk
    pq_path = Path(card_goto.parquet_uri)
    orig_bytes = pq_path.read_bytes()
    pq_path.write_bytes(orig_bytes + b"TAMPER")

    check_tampered = verify_merkle_chain(vault_dir=vault_dir)
    assert check_tampered["valid"] is False
    assert len(check_tampered["errors"]) >= 1

    # Restore original bytes and re-verify
    pq_path.write_bytes(orig_bytes)
    assert verify_merkle_chain(vault_dir=vault_dir)["valid"] is True


def test_phase5_live_market_feed_and_otel_tracing(tmp_path: Path) -> None:
    """
    Verify Phase 5 Live Market Feed and OpenTelemetry Tracing:
    - Runs run_swrt_pipeline with ticker='BMRI' and regime='LIVE_MARKET_FEED'.
    - Verifies IDX tick validity on all price outputs.
    - Verifies otel_trace in pillar_diagnostics with 32-character trace_id and stage_latencies_ms.
    - Verifies Merkle chain validity in DuckDB audit ledger.
    """
    vault_dir = str(tmp_path / "audit_vault")
    card = run_swrt_pipeline(
        ticker="BMRI",
        regime="LIVE_MARKET_FEED",
        capital_rp=100_000_000.0,
        vault_dir=vault_dir,
    )

    assert card.ticker == "BMRI"
    assert card.regime == "LIVE_MARKET_FEED"
    assert is_valid_idx_tick(card.entry_limit_rp)
    assert is_valid_idx_tick(card.take_profit_rp)
    assert is_valid_idx_tick(card.stop_loss_pre_arb_rp)
    assert len(card.receipt_sha256) == 64

    # Verify OpenTelemetry trace diagnostics
    assert "otel_trace" in card.pillar_diagnostics
    otel_trace = card.pillar_diagnostics["otel_trace"]
    assert "trace_id" in otel_trace
    assert len(otel_trace["trace_id"]) == 32
    assert "stage_latencies_ms" in otel_trace
    assert isinstance(otel_trace["stage_latencies_ms"], dict)

    # Verify Merkle audit chain
    chain_check = verify_merkle_chain(vault_dir=vault_dir)
    assert chain_check["valid"] is True


def test_phase6_oauth_multi_agent_models_and_quota_tracking(tmp_path: Path) -> None:
    """
    Verify Phase 6 OAuth Multi-Agent Setup, Model Catalog, and Quota Tracking:
    - Verifies that run_swrt_pipeline binds DEFAULT_BOUND_AUTHZ_CODE,
      executes the 1 Argon + 2 Flash 3.8 subagent topology across all 5 agents (BDM, LOB, NLP, MAC, EXE),
      tracks per-model requests_used / tokens_used, and records oauth_multi_agent in the Merkle receipt.
    """
    vault_dir = str(tmp_path / "audit_vault")
    card = run_swrt_pipeline(
        ticker="BBCA",
        regime="COHERENT_ACCUMULATION",
        capital_rp=100_000_000.0,
        vault_dir=vault_dir,
    )

    assert "oauth_multi_agent" in card.pillar_diagnostics
    oauth_ma = card.pillar_diagnostics["oauth_multi_agent"]
    assert oauth_ma["oauth_bound_code"] == DEFAULT_BOUND_AUTHZ_CODE
    assert oauth_ma["active_preset"] == "1_ARGON_2_FLASH"
    assert len(oauth_ma["subagent_assignments"]) == 3

    execs = oauth_ma["agent_executions"]
    assert execs["EXE"]["model_id"] == "argon-prime"
    assert execs["BDM"]["model_id"] == "gemini-3.8-flash"
    assert execs["LOB"]["model_id"] == "gemini-3.8-flash"
    assert execs["NLP"]["model_id"] == "gemini-3.8-flash"
    assert execs["MAC"]["model_id"] == "gemini-3.8-flash"
    for ag in ("BDM", "LOB", "NLP", "MAC", "EXE"):
        assert execs[ag]["oauth_verified"] is True
        assert execs[ag]["tokens_used"] > 0

    assert verify_merkle_chain(vault_dir=vault_dir)["valid"] is True


def test_negative_results_stay_negative_and_false_positive_rate_below_5pct(tmp_path: Path) -> None:
    """
    Verify:
    1. Negative / bearish stocks (e.g. UNVR, BUKA, GOTO) retain negative stalk drift (mu_5d < 0),
       negative expected 5-day returns (expected_5d_return < 0), downward 10-day trajectory cones,
       and 0 approved lots (no forced positive values).
    2. Across 1,000 null-hypothesis / non-edge / noisy market trials, the False Positive Rate (FPR)
       of recommending `action == 'BUY'` (`approved_lots > 0`) is strictly < 5% (0.05).
    """
    import numpy as np
    from services.swrt_math_kernel_mcp.server import (
        compute_sheaf_cohomology,
        solve_wdro_lot_sizing,
    )

    vault_dir = str(tmp_path / "audit_vault_neg")

    for neg_ticker in ("UNVR", "BUKA", "GOTO"):
        card = run_swrt_pipeline(
            ticker=neg_ticker,
            regime="LIVE_MARKET_FEED",
            capital_rp=100_000_000.0,
            vault_dir=vault_dir,
        )
        assert card.approved_lots == 0
        assert card.action != "BUY"
        # Consensus drift and expected 5D return must be genuinely negative
        assert card.consensus_stalk[0] < 0.0, f"{neg_ticker} consensus mu_5d should be negative"
        assert card.stalks["BDM"].mu_5d < 0.0, f"{neg_ticker} BDM mu_5d should be negative"
        assert card.stalks["LOB"].mu_5d < 0.0, f"{neg_ticker} LOB mu_5d should be negative"
        wdro_diag = card.pillar_diagnostics["wdro"]
        assert wdro_diag["expected_5d_return"] < 0.0, f"{neg_ticker} expected_5d_return must be negative"
        assert wdro_diag["worst_case_wdro_return"] < 0.0
        # 10-day trajectory cone must drift downward
        assert card.trajectory_cone[-1].mean_rp < card.trajectory_cone[0].mean_rp

    # 2. Monte Carlo False Positive Rate (FPR) test over N = 1,000 random null-hypothesis trials
    rng = np.random.default_rng(20261029)
    n_trials = 1000
    false_positives = 0

    for _ in range(n_trials):
        # Null hypothesis: zero-mean random walk / noisy / conflicting / bearish market
        # where true expected drift across pillars is centered at 0.0 with std 0.45
        stalks = {}
        for ag in ("BDM", "LOB", "NLP", "MAC"):
            mu_v = float(np.clip(rng.normal(-0.02, 0.42), -0.98, 0.98))
            theta_v = float(np.clip(rng.uniform(0.25, 0.95), 0.15, 1.50))
            liq_v = float(np.clip(rng.normal(0.0, 0.40), -0.95, 0.95))
            harb_v = float(np.clip(rng.beta(2.0, 5.0), 0.02, 0.95))
            stalks[ag] = [mu_v, theta_v, liq_v, harb_v]

        sheaf_res = compute_sheaf_cohomology(stalks_by_agent=stalks, cohomology_threshold=0.70)
        wdro_res = solve_wdro_lot_sizing(
            sheaf_phi=float(sheaf_res["sheaf_phi"]),
            consensus_stalk=[float(x) for x in sheaf_res["consensus_stalk"]],
            entry_price_rp=2500,
            capital_rp=100_000_000.0,
        )
        if wdro_res["action"] == "BUY" and wdro_res["approved_lots"] > 0:
            false_positives += 1

    fpr = false_positives / float(n_trials)
    assert fpr < 0.05, f"False Positive Rate {fpr:.3%} exceeded 5% ceiling!"



