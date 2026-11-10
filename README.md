# AMAQDE — Auditable Multi-Agent Quantitative Decision Engine
### Free ($0/month), Local-First, Mathematically Proven Decision Engine for the Indonesia Stock Exchange (IDX / BEI)

[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![Rust 2021](https://img.shields.io/badge/rust-2021-orange.svg)](https://www.rust-lang.org/)
[![Next.js 14](https://img.shields.io/badge/Next.js-14.2-black.svg)](https://nextjs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r169-brightgreen.svg)](https://threejs.org/)
[![DuckDB](https://img.shields.io/badge/DuckDB-1.1-yellow.svg)](https://duckdb.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 📌 Short Description (for GitHub About / Bio)
> **100% Free ($0/month), local-first, auditable multi-agent quantitative decision engine for the Indonesia Stock Exchange (IDX / BEI), powered by Topological Sheaf Cohomology, Entropic Optimal Transport (Sinkhorn), Rough Path Signatures, WDRO Lot Sizing, and SHA-256 Merkle Audit Ledger.**

---

## 🎯 Executive Summary & Core Invariants

**AMAQDE** (also known as the **IDX SWRT Engine**) is a institutional-grade, zero-cost, local-first quantitative system engineered specifically for the microstructure of the **Indonesia Stock Exchange (IDX / BEI)**. 

Unlike traditional trading bots that rely on fragile LLM text prompts or lagging technical indicators (RSI/MACD), AMAQDE enforces five strict operational invariants:

1. **Read-Only Human-in-the-Loop (HITL):** The system **never** places direct broker orders automatically. It computes and displays **1 Unified, Mathematically Proven Decision Card** containing exact broker ticks, position lots, expected holding days, pre-ARB stop-losses, and forward trajectory cones for the human operator to execute manually.
2. **Zero-Cost Invariant ($0/month):** Engineered exclusively using free, open-source engines: high-speed native **Rust**, local **DuckDB / zstd Parquet** audit storage, local **uv/Python**, browser-based CDP WebSocket market taps, and local Ollama or free-tier Gemini API.
3. **No LLM Math Invariant:** Language models are strictly barred from calculating target prices, stops, or probabilities. All 5 agent state vectors are fed into deterministic, closed-form mathematical kernels implemented in **Rust** and **FastMCP**.
4. **IDX Regulatory Microstructure Enforcement (*Kep-00157/BEI/10-2026*):**
   - **Fraksi Harga (Tick Sizes):** Enforces discrete Indonesian pricing steps (Rp1, Rp2, Rp5, Rp10, Rp25).
   - **Pre-ARB Hard Stop-Loss (-5.2%):** Halts drawdowns before the regulatory **-7% Auto-Rejection Bawah (ARB)** queue freezes bid liquidity.
   - **IDX Lot Math & Fees:** 1 Lot = 100 shares; includes realistic $0.40\%$ round-trip transaction fee buffers ($0.15\%$ buy, $0.25\%$ sell).
5. **100% Forensic Auditability:** Every decision, trade recommendation, or system block automatically mints an immutable **SHA-256 Merkle-chained receipt** stored in local DuckDB, pointing to a bit-exact, millisecond-stamped raw Parquet snapshot of the orderbook and broker summary.

---

## 🏛️ The 5 Mathematical Pillars (SWRT Architecture)

```
                    ┌──────────────────────────────────────────────┐
                    │      IDX JIT Real-Time WebSocket Tap         │
                    └──────┬──────────────┬──────────────┬─────────┘
                           │              │              │
                     [Broker Flow]   [LOB Ticks]    [IDXNet / LK]
                           │              │              │
                           ▼              ▼              ▼
   ┌──────────────────────────────┐ ┌──────────────────────────────┐
   │ Pillar 1: BDM (Bandar Flow)  │ │ Pillar 2: LOB (Rough Paths)  │
   │ Entropic Optimal Transport   │ │ Depth-3 Signatures &         │
   │ (Sinkhorn-Knopp 2-Wasserstein│ │ Lévy Area Spoofing Detector  │
   └──────────────┬───────────────┘ └──────────────┬───────────────┘
                  │                                │
                  ├────────────────┬───────────────┤
                  ▼                ▼               ▼
   ┌──────────────────────────────┐ ┌──────────────────────────────┐
   │ Pillar 3: NLP (IDXNet News)  │ │ Pillar 4: MAC (Macro/LK Solv)│
   │ Keterbukaan Informasi, UMA,  │ │ Commodity Regimes & Altman-Z │
   │ & Sentiment Parser           │ │ Solvency Multipliers         │
   └──────────────┬───────────────┘ └──────────────┬───────────────┘
                  │                                │
                  └────────────────┬───────────────┘
                                   │
                                   ▼
    ┌─────────────────────────────────────────────────────────────┐
    │     Pillar 5: Topological Sheaf Unifier (EXE Engine)        │
    │  • Cellular Sheaf Laplacian (L_F) & Dirichlet Energy Φ(x)   │
    │  • Wasserstein Distributionally Robust Opt (WDRO) Lots      │
    │  • Ornstein-Uhlenbeck (OU) First-Passage Optimal Stopping   │
    └──────────────────────────────┬──────────────────────────────┘
                                   │
                                   ▼
    ┌─────────────────────────────────────────────────────────────┐
    │          Deterministic Rust & FastMCP Math Kernel           │
    │               (Sub-millisecond latency)                     │
    └──────────────────────────────┬──────────────────────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
┌──────────────────────────────┐          ┌──────────────────────────────┐
│  DuckDB SHA-256 Merkle Vault │          │   Next.js 14 Web Cockpit     │
│   (Immutable Audit Ledger)   │          │  (3D Pentagon Tensegrity UI) │
└──────────────────────────────┘          └──────────────────────────────┘
```

### 1. Pillar 1: Bandar Detector (`agent_bdm_bandar.py`)
- Solves entropic-regularized Optimal Transport ($W_2$ distance) across broker accumulation matrices using the **Sinkhorn-Knopp** algorithm.
- Uncovers institutional broker accumulation versus retail distribution networks.

### 2. Pillar 2: Limit Order Book Rough Path Signatures (`agent_lob_rough.py`)
- Evaluates depth-3 iterated path integrals and **Lévy Area** over high-frequency bid/ask level oscillations.
- Identifies fleeting bid spoofing and quantifies the **$-7\%$ ARB queue hazard** ($h_{\text{ARB}}$).

### 3. Pillar 3: IDXNet NLP & Corporate Catalyst Agent (`agent_nlp_catalyst.py`)
- Ingests structured and unstructured disclosures from IDXNet (*Keterbukaan Informasi*), unusual market activity (UMA) notices, suspension alerts, and insider filings.

### 4. Pillar 4: Macro & Solvency Agent (`agent_mac_valuation.py`)
- Models systemic macro correlations (USD/IDR exchange rates, benchmark coal, nickel, CPO commodity cycles).
- Evaluates Indonesian financial statements (LK) using Altman Z-Score and solvency health metrics.

### 5. Pillar 5: Sheaf Cohomology, WDRO & OU Stopping (`agent_exe_unifier.py`)
- **Topological Consensus:** Maps all 4 extractor stalks into a cellular sheaf over a graph. The Sheaf Laplacian $L_{\mathcal{F}}$ and Dirichlet Energy $\Phi(x)$ calculate geometric consensus, flagging internal contradictions.
- **WDRO Lot Sizing:** Solves worst-case expectation over an ambiguity ball of radius $\varepsilon(\Phi)$ around empirical distributions, providing mathematically conservative lot allocations.
- **OU Optimal Stopping:** Determines the exact entry tick, take-profit tick, time-stop horizon, and 10-day forward trajectory cone via mean-reverting first-passage times.

---

## 📂 Repository Structure

```text
amaqde/
├── .agents/
│   ├── plugins/                 # Antigravity agent plugin manifests
│   ├── rules/
│   │   └── idx-math-and-audit.md # Hard tick size & ARB circuit breaker rules
│   └── skills/
│       └── run-swrt-pipeline/   # Antigravity skill definitions
├── agents/                      # Specialized Stalk Extractor Agents
│   ├── agent_bdm_bandar.py      # Pillar 1: Sinkhorn-Knopp Broker Flow
│   ├── agent_lob_rough.py       # Pillar 2: Rough Path LOB & ARB Hazard
│   ├── agent_nlp_catalyst.py    # Pillar 3: IDXNet Disclosures & Catalysts
│   ├── agent_mac_valuation.py   # Pillar 4: Macroeconomic & LK Solvency
│   ├── agent_exe_unifier.py     # Pillar 5: Sheaf Laplacian + WDRO + OU
│   └── schemas.py               # Pydantic v2 stalk & decision card schemas
├── audit_vault/                 # DuckDB ledger & daily raw Parquet snapshots
├── frontend/                    # Next.js 14 + Three.js 3D Radar & Audit UI
│   ├── src/app/                 # Next.js App Router (History, OAuth, Copilot)
│   └── src/components/          # PentagonTensegrityRadar, DecisionCard, etc.
├── services/
│   ├── audit_tap_service/       # Python FastAPI/DuckDB ledger bridge
│   ├── jit_market_tap/          # Playwright CDP WebSocket market data tap
│   ├── merkle_audit_mcp/        # FastMCP server for SHA-256 Merkle receipts
│   ├── rust_math_kernel/        # Native Axum/Rust high-speed math solver
│   └── swrt_math_kernel_mcp/    # FastMCP wrapper & Python fallback kernel
├── tests/                       # Pytest test suite for SWRT pipeline & Rust bridge
├── docker-compose.yml           # Microservices stack (Rust + Python Tap + Next.js)
├── Makefile                     # Developer commands & pipeline targets
├── pyproject.toml               # Python dependencies (managed via uv)
└── uv.lock                      # Deterministic Python lockfile
```

---

## ⚡ Quickstart & Running AMAQDE

### Prerequisites
- [Docker & Docker Compose](https://docs.docker.com/get-docker/) (recommended for full stack)
- Or for local native development:
  - [uv](https://docs.astral.sh/uv/) (Python 3.12+)
  - [Node.js](https://nodejs.org/) (v18+ or v20+)
  - [Rust & Cargo](https://rustup.rs/) (for the native math kernel)

---

### Option A: Complete Stack with Docker Compose (Fastest)

Launch all three integrated microservices with one command:
```bash
docker compose up --build -d
```

| Service | Port | Description |
| :--- | :--- | :--- |
| **`swrt-web-ui`** | `http://localhost:3000` | Next.js 14 + Three.js 3D Radar Cockpit & Decision Cards |
| **`swrt-rust-kernel`** | `http://localhost:4001` | High-speed Rust mathematical engine |
| **`swrt-audit-tap`** | `http://localhost:4002` | DuckDB audit ledger, receipts, and WebSocket bridge |

View container logs:
```bash
make docker-logs
```

---

### Option B: Local Native Development

#### 1. Setup Python Environment with `uv`
```bash
# Install dependencies
uv sync --python 3.12
```

#### 2. Run the Full Test Suite
Verify all 5 mathematical pillars, tick rounding rules, and audit receipts:
```bash
make test
# Or directly:
uv run pytest tests/ -v
```

#### 3. Run Pipeline Diagnostics for IDX Tickers
Execute the multi-agent unifier across volatile, trending, and ARB-hazard regimes:
```bash
make run-pipeline
```

#### 4. Launch Next.js Frontend
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the 3D Pentagon Tensegrity Radar, real-time decision cards, and Merkle audit inspector.

---

## 🛡️ Microstructure Rules & Compliance Table

| Regulatory Rule | Parameter | Implementation Enforcement |
| :--- | :--- | :--- |
| **IDX Tick Fraksi (< Rp200)** | Rp1 / tick | `round_to_idx_tick()` |
| **IDX Tick Fraksi (Rp200 – Rp500)** | Rp2 / tick | `round_to_idx_tick()` |
| **IDX Tick Fraksi (Rp500 – Rp2,000)** | Rp5 / tick | `round_to_idx_tick()` |
| **IDX Tick Fraksi (Rp2,000 – Rp5,000)**| Rp10 / tick | `round_to_idx_tick()` |
| **IDX Tick Fraksi (>= Rp5,000)** | Rp25 / tick | `round_to_idx_tick()` |
| **Asymmetric ARB Circuit Breaker** | -7.0% | Pre-ARB stop capped strictly at **$-5.2\%$** |
| **IDX Lot Size** | 100 shares | Discrete lot quantification with floor rounding |
| **Round-Trip Transaction Cost** | 0.40% | $0.15\%$ Buy + $0.25\%$ Sell slippage deduction |
| **Audit Requirement** | 100% auditable | SHA-256 Merkle chain in DuckDB with millisecond Parquet |

---

## 🔬 Forensic Audit Vault & Merkle Replay

Every single signal generated produces an immutable cryptographic receipt:
```json
{
  "receipt_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "prev_receipt_hash": "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e",
  "timestamp_utc": "2026-11-02T02:27:29.888Z",
  "ticker": "BUMI",
  "action": "BUY",
  "recommended_lots": 142,
  "entry_limit_rp": 142,
  "take_profit_rp": 158,
  "stop_loss_pre_arb_rp": 135,
  "dirichlet_energy": 0.0421,
  "parquet_uri": "audit_vault/2026-11-02/BUMI_022729_888_raw.parquet"
}
```
Receipts can be audited, replayed, and verified directly inside the web UI at `http://localhost:3000/history` or queried with SQL via DuckDB CLI:
```sql
SELECT timestamp_utc, ticker, action, recommended_lots, entry_limit_rp, receipt_sha256 
FROM 'audit_vault/audit_ledger.duckdb'.'audit_receipts' 
ORDER BY timestamp_utc DESC LIMIT 10;
```

---

## 🤝 OAuth 2.1 & MCP Integration (How to Access & Use)

AMAQDE includes a local-first **OAuth 2.1 Authorization Server with PKCE** (RFC 7636) and native **Model Context Protocol (FastMCP)** endpoints. This enables any developer, AI assistant (Google Antigravity, Claude Desktop, Cursor), or custom script to securely query models, invoke deterministic quantitative tools, and inspect audit ledgers.

### 🔑 1. How Anyone Can Authorize via OAuth

By default, the engine runs with a demo session (`ag_authz_example_user_session`) out-of-the-box so you can start immediately without extra configuration.

To generate and bind your own authenticated session:

1. **Start the Web UI** (`http://localhost:3000`).
2. **Authorize via Browser (PKCE)**:
   Navigate to the authorization URL:
   ```text
   http://localhost:3000/api/oauth/authorize?client_id=antigravity-ide-mcp-client&response_type=code&scope=mcp:tools+mcp:resources+swrt:read_only_hitl+merkle:verify&code_challenge_method=S256&code_challenge=E9Melhoa2OwvFrGMTJguCHaoeK1t8URWbuGJSstw-cM&state=public-access-demo
   ```
3. Click **"Authorize Antigravity IDE"** in the consent screen. The server will redirect you with a fresh authorization code (e.g. `ag_authz_...`).
4. **Bind the Code in the Web Cockpit**:
   - Go to the **"Agents & OAuth"** tab on `http://localhost:3000`.
   - Paste your `ag_authz_...` code in the **Bind OAuth Code** field and click **"Bind OAuth"**.
   - All 5 agents and subagents will instantly link to your session and quota tracker.

### ⚙️ 2. Environment Variable Configuration

You can also pass your OAuth authorization code via environment variable before starting the containers:

```bash
# Copy the example environment template
cp .env.example .env

# Edit .env and set your custom code:
# ANTIGRAVITY_OAUTH_CODE=ag_authz_your_custom_code_here
```

### 🔌 3. Model Context Protocol (FastMCP) Setup

AMAQDE exposes 4 specialized MCP servers defined in [`mcp_config.json`](mcp_config.json):
- `idx-swrt-web-mcp`: Streamable HTTP MCP endpoint (`http://localhost:3000/api/mcp`).
- `swrt-math-kernel`: High-speed Sinkhorn-Sheaf-WDRO math kernel.
- `merkle-audit-ledger`: DuckDB Merkle audit verification tool.
- `idx-structural-quant`: Just-In-Time market data tap and orderbook snapshot extractor.

To connect them to Google Antigravity or Claude Desktop:
```json
{
  "mcpServers": {
    "idx-swrt-web-mcp": {
      "url": "http://localhost:3000/api/mcp"
    },
    "swrt-math-kernel": {
      "command": "uv",
      "args": ["run", "python", "-m", "services.swrt_math_kernel_mcp.server"],
      "env": {
        "PYTHONPATH": "."
      }
    },
    "merkle-audit-ledger": {
      "command": "uv",
      "args": ["run", "python", "-m", "services.merkle_audit_mcp.server"],
      "env": {
        "PYTHONPATH": "."
      }
    }
  }
}
```

---

## ⚖️ Disclaimer & License

> **DISCLAIMER:** This software is developed for quantitative research and educational decision support only. It does NOT constitute financial advice or automated order routing. Trading on the Indonesia Stock Exchange involves market risk and potential loss of capital. The authors and contributors assume no liability for trading decisions executed by users.

Licensed under the [MIT License](LICENSE).
