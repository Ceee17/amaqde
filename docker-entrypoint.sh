#!/usr/bin/env bash
set -e

cd /app
mkdir -p /app/audit_vault

# Initialize DuckDB Merkle Audit Vault & 3 canonical IDX regimes if not yet seeded
if [ ! -f "/app/audit_vault/latest_receipts.json" ]; then
  echo "[idx-swrt-engine] Seeding initial DuckDB SHA-256 Merkle receipts & zstd Parquet snapshots..."
  /opt/venv/bin/python -m agents.agent_exe_unifier --run-all-regimes
fi

echo "[idx-swrt-engine] Starting Next.js Quantitative Terminal & MCP Streamable HTTP Server on 0.0.0.0:3000..."
cd /app/frontend
exec npm run start -- -H 0.0.0.0 -p 3000
