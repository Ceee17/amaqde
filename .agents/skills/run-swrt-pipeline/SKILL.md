---
name: run-swrt-pipeline
description: Executes and verifies the end-to-end Just-In-Time (JIT) IDX data pull, 5-agent stalk extraction, Sheaf-WDRO-Stopping mathematical solve, and DuckDB Merkle audit receipt generation for any IDX ticker.
---

## Prerequisites
- Python 3.11+ virtual environment with `fastmcp`, `duckdb`, `pyarrow`, `pot`, `scipy`, `cvxpy`, `clarabel`, `pydantic`, `arize-phoenix` installed.
- Local `audit_vault/` directory initialized.

## Execution Steps
1. **JIT Snapshot Pull & Freeze:**
   Fetch current L2 Orderbook, last 1,000 Running Trade ticks, Intraday Broker Summary, and IDXNet filings for `ticker`. Immediately serialize raw inputs to `audit_vault/YYYY-MM-DD/{ticker}_{HHMMSS}_raw.parquet` and compute `snapshot_sha256`.
2. **Stalk Extraction:**
   Run `agent_bdm`, `agent_lob`, `agent_nlp`, and `agent_mac` to produce normalized 4D stalk vectors $x_v = [\mu_{5d}, \theta^*, L, h_{\text{ARB}}]$.
3. **Sheaf Cohomology & WDRO + Optimal Stopping Solve:**
   Call `swrt_math_kernel_mcp` to compute Sheaf Energy $\Phi(x)$, pairwise fault matrix $\delta x$, WDRO optimal lot count, Entry/TP/SL IDX-rounded ticks, Expected Holding Days $\mathbb{E}[\tau^*]$, Hard Time-Stop $T_{\max}$, and daily trajectory cone.
4. **Merkle Receipt Commit:**
   Chain `prev_merkle_hash` + `snapshot_sha256` + `decision_json` into a new `receipt_sha256` inside `audit_vault/audit_ledger.duckdb`.

## Verification
- Run `pytest tests/test_swrt_pipeline.py` verifying that:
  1. A simulated "Bandar Bull Trap" (NLP = +0.90, BDM = -0.80) produces $\Phi(x) > 0.70$ and forces `approved_lots == 0`.
  2. A simulated "Coherent Accumulation" produces valid IDX-tick-aligned `entry_limit_rp`, `take_profit_rp`, `stop_loss_pre_arb_rp`, `expected_holding_days`, and a verified DuckDB Merkle hash.