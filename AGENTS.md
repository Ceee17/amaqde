# IDX SWRT Engine — Master Architecture & Antigravity Specification

## 1. Mission & Core Constraints
Build a **100% Free ($0/month), Local-First, Auditable Multi-Agent Quantitative Decision Engine** for the Indonesia Stock Exchange (IDX / BEI).
- **Execution Mode:** Read-Only Human-in-the-Loop (HITL). The system NEVER submits live broker orders automatically. It outputs **1 Unified, Mathematically Proven Decision Card** (Action, Exact Lots, Entry Tick, Take-Profit Tick, Pre-ARB Stop-Loss Tick, Expected Holding Days, Time-Stop Date, and Forward Trajectory Cone) for the human trader to execute manually.
- **Zero-Cost Invariant:** Use ONLY free, open-source libraries, local DuckDB/Parquet storage, local Ollama or free-tier Gemini API, and Just-In-Time (JIT) local browser WebSocket / open-source IDX MCP servers.
- **No LLM Math Invariant:** Agents NEVER average scores or guess target prices in natural language. All 5 agent state vectors must pass through the deterministic Python math kernel (`swrt-math-kernel-mcp`).
- **100% Forensic Auditability:** Every decision or blocked trade MUST generate an immutable SHA-256 Merkle-chained receipt in local DuckDB (`audit_vault/audit_ledger.duckdb`) linked to a frozen zstd Parquet snapshot of the raw orderbook and broker summary at that exact millisecond.

## 2. Target Repository Structure
```text
idx-swrt-engine/
├── AGENTS.md
├── mcp_config.json
├── Makefile
├── .agents/
│   ├── rules/
│   │   └── idx-math-and-audit.md
│   └── skills/
│       └── run-swrt-pipeline/
│           └── SKILL.md
├── services/
│   ├── jit_market_tap/          # Playwright CDP WebSocket tap + idx-bei / ktbknidx wrappers
│   ├── swrt_math_kernel_mcp/    # FastMCP server: Sinkhorn, Rough Path, Sheaf Laplacian, WDRO + Optimal Stopping
│   └── merkle_audit_mcp/        # FastMCP server: DuckDB + Parquet SHA-256 Merkle Receipt + Arize Phoenix OTel
├── agents/                      # 5 Specialized Stalk Extractor Agents (Pydantic schemas)
│   ├── agent_bdm_bandar.py      # Pillar 1: Entropic Optimal Transport (Sinkhorn-Knopp)
│   ├── agent_lob_rough.py       # Pillar 2: Rough Path Signatures & 7% ARB Hazard
│   ├── agent_nlp_catalyst.py    # IDXNet Keterbukaan Informasi & UMA parser
│   ├── agent_mac_valuation.py   # Macro (USD/IDR, Coal, Nickel, CPO) + LK Solvency
│   └── agent_exe_unifier.py     # Pillar 3, 4, 5: Sheaf Cohomology + WDRO + OU Optimal Stopping
├── audit_vault/                 # Local DuckDB ledger + daily raw Parquet snapshots
└── frontend/                    # Next.js + Three.js Pentagon Tensegrity Radar & Audit Replay UI