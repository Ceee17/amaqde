"""
Forensic Merkle Audit MCP Server (`merkle-audit-ledger`).

Enforces 100% Forensic Auditability:
- Every decision or blocked trade generates an immutable SHA-256 Merkle-chained receipt
  in local DuckDB (`audit_vault/audit_ledger.duckdb`) linked to a frozen `zstd` Parquet
  snapshot of the raw orderbook, running trade ticks, and broker summary at that exact millisecond.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any

import duckdb
from fastmcp import FastMCP
import pyarrow as pa
import pyarrow.parquet as pq

mcp = FastMCP("merkle-audit-ledger")

GENESIS_PREV_HASH = "0" * 64


def canonical_json(data: Any) -> str:
    """Serialize any dictionary/list into deterministic canonical JSON."""
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def compute_sha256_bytes(payload: bytes) -> str:
    """Return hex SHA-256 digest of bytes."""
    return hashlib.sha256(payload).hexdigest()


def compute_merkle_receipt_hash(
    prev_merkle_hash: str,
    snapshot_sha256: str,
    decision_canonical_json: str,
) -> str:
    """
    Compute the deterministic Merkle chain hash:
    SHA256(prev_merkle_hash + "|" + snapshot_sha256 + "|" + decision_canonical_json)
    """
    preimage = f"{prev_merkle_hash}|{snapshot_sha256}|{decision_canonical_json}"
    return compute_sha256_bytes(preimage.encode("utf-8"))


def _init_duckdb_schema(conn: duckdb.DuckDBPyConnection) -> None:
    """Ensure the append-only `audit_receipts` table exists in DuckDB."""
    conn.execute(
        """
        CREATE SEQUENCE IF NOT EXISTS seq_audit_receipt_id START 1;
        CREATE TABLE IF NOT EXISTS audit_receipts (
            seq_id BIGINT DEFAULT nextval('seq_audit_receipt_id') PRIMARY KEY,
            created_at_utc VARCHAR NOT NULL,
            ticker VARCHAR NOT NULL,
            regime VARCHAR NOT NULL,
            action VARCHAR NOT NULL,
            approved_lots INTEGER NOT NULL,
            sheaf_phi DOUBLE NOT NULL,
            h_arb DOUBLE NOT NULL,
            entry_limit_rp BIGINT NOT NULL,
            take_profit_rp BIGINT NOT NULL,
            stop_loss_pre_arb_rp BIGINT NOT NULL,
            parquet_uri VARCHAR NOT NULL,
            snapshot_sha256 VARCHAR NOT NULL,
            prev_merkle_hash VARCHAR NOT NULL,
            receipt_sha256 VARCHAR NOT NULL,
            decision_json VARCHAR NOT NULL
        );
        """
    )


@mcp.tool()
def freeze_raw_snapshot(
    ticker: str,
    regime: str,
    raw_payload: dict[str, Any],
    vault_dir: str = "audit_vault",
    timestamp_override: str | None = None,
) -> dict[str, str]:
    """
    Immediately serialize the raw L2 Orderbook, 1,000 Running Trade ticks,
    Intraday Broker Summary, and IDXNet filings to:
    `audit_vault/YYYY-MM-DD/{ticker}_{HHMMSS}_raw.parquet` (zstd compressed)
    and compute `snapshot_sha256`.
    """
    now_dt = (
        datetime.fromisoformat(timestamp_override)
        if timestamp_override
        else datetime.now(timezone.utc)
    )
    date_folder = now_dt.strftime("%Y-%m-%d")
    time_slug = now_dt.strftime("%H%M%S_%f")[:10]

    vault_path = Path(vault_dir)
    day_dir = vault_path / date_folder
    day_dir.mkdir(parents=True, exist_ok=True)

    clean_ticker = ticker.upper().strip()
    parquet_filename = f"{clean_ticker}_{time_slug}_raw.parquet"
    parquet_path = day_dir / parquet_filename

    # Construct tabular PyArrow representation of the complete raw snapshot
    table = pa.Table.from_pylist(
        [
            {
                "ticker": clean_ticker,
                "regime": regime,
                "captured_at_utc": now_dt.isoformat(),
                "prev_close_rp": int(raw_payload.get("prev_close_rp", 0)),
                "last_price_rp": int(raw_payload.get("last_price_rp", 0)),
                "orderbook_json": canonical_json(raw_payload.get("orderbook", {})),
                "running_trades_json": canonical_json(raw_payload.get("running_trades", [])),
                "broker_summary_json": canonical_json(raw_payload.get("broker_summary", {})),
                "idxnet_filings_json": canonical_json(raw_payload.get("idxnet_filings", [])),
                "macro_lk_json": canonical_json(raw_payload.get("macro_lk", {})),
            }
        ]
    )
    pq.write_table(table, parquet_path, compression="zstd")

    raw_bytes = parquet_path.read_bytes()
    snapshot_sha256 = compute_sha256_bytes(raw_bytes)
    rel_uri = parquet_path.as_posix()

    return {
        "ticker": clean_ticker,
        "regime": regime,
        "parquet_uri": rel_uri,
        "snapshot_sha256": snapshot_sha256,
        "captured_at_utc": now_dt.isoformat(),
        "byte_size": str(len(raw_bytes)),
    }


@mcp.tool()
def commit_merkle_receipt(
    ticker: str,
    regime: str,
    snapshot_sha256: str,
    parquet_uri: str,
    decision_payload: dict[str, Any],
    vault_dir: str = "audit_vault",
) -> dict[str, Any]:
    """
    Chain `prev_merkle_hash` + `snapshot_sha256` + `decision_json` into a new
    `receipt_sha256` inside `audit_vault/audit_ledger.duckdb`.
    """
    if not snapshot_sha256 or len(snapshot_sha256) != 64:
        raise ValueError("Invalid snapshot_sha256: must be a 64-char hex SHA-256 digest.")
    if not parquet_uri:
        raise ValueError("Missing parquet_uri for Merkle audit receipt.")

    vault_path = Path(vault_dir)
    vault_path.mkdir(parents=True, exist_ok=True)
    db_path = vault_path / "audit_ledger.duckdb"

    created_at_utc = datetime.now(timezone.utc).isoformat()
    decision_core = dict(decision_payload)
    # Remove mutable receipt fields before computing canonical decision digest
    decision_core.pop("receipt_sha256", None)
    decision_core.pop("prev_merkle_hash", None)
    decision_core["snapshot_sha256"] = snapshot_sha256
    decision_core["parquet_uri"] = parquet_uri

    decision_json = canonical_json(decision_core)

    conn = duckdb.connect(str(db_path))
    try:
        _init_duckdb_schema(conn)
        prev_row = conn.execute(
            "SELECT receipt_sha256 FROM audit_receipts ORDER BY seq_id DESC LIMIT 1"
        ).fetchone()
        prev_merkle_hash = str(prev_row[0]) if prev_row else GENESIS_PREV_HASH

        receipt_sha256 = compute_merkle_receipt_hash(
            prev_merkle_hash=prev_merkle_hash,
            snapshot_sha256=snapshot_sha256,
            decision_canonical_json=decision_json,
        )

        conn.execute(
            """
            INSERT INTO audit_receipts (
                created_at_utc, ticker, regime, action, approved_lots,
                sheaf_phi, h_arb, entry_limit_rp, take_profit_rp, stop_loss_pre_arb_rp,
                parquet_uri, snapshot_sha256, prev_merkle_hash, receipt_sha256, decision_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                created_at_utc,
                ticker.upper().strip(),
                regime,
                str(decision_core.get("action", "UNKNOWN")),
                int(decision_core.get("approved_lots", 0)),
                float(decision_core.get("sheaf_phi", 0.0)),
                float(decision_core.get("h_arb", 0.0)),
                int(decision_core.get("entry_limit_rp", 0)),
                int(decision_core.get("take_profit_rp", 0)),
                int(decision_core.get("stop_loss_pre_arb_rp", 0)),
                parquet_uri,
                snapshot_sha256,
                prev_merkle_hash,
                receipt_sha256,
                decision_json,
            ],
        )

        seq_row = conn.execute(
            "SELECT seq_id FROM audit_receipts WHERE receipt_sha256 = ? ORDER BY seq_id DESC LIMIT 1",
            [receipt_sha256],
        ).fetchone()
        seq_id = int(seq_row[0]) if seq_row else 1
    finally:
        conn.close()

    # Sync live JSON mirror for zero-lock frontend inspection alongside DuckDB queries
    _sync_json_mirror(vault_dir=vault_dir)

    return {
        "seq_id": seq_id,
        "created_at_utc": created_at_utc,
        "ticker": ticker.upper().strip(),
        "regime": regime,
        "parquet_uri": parquet_uri,
        "snapshot_sha256": snapshot_sha256,
        "prev_merkle_hash": prev_merkle_hash,
        "receipt_sha256": receipt_sha256,
    }


@mcp.tool()
def verify_merkle_chain(vault_dir: str = "audit_vault") -> dict[str, Any]:
    """
    Cryptographically verify the entire DuckDB Merkle receipt ledger from genesis
    to head, ensuring both SHA-256 hash chain continuity and Parquet snapshot integrity.
    """
    db_path = Path(vault_dir) / "audit_ledger.duckdb"
    if not db_path.exists():
        return {
            "valid": True,
            "total_receipts": 0,
            "head_receipt_sha256": GENESIS_PREV_HASH,
            "errors": [],
        }

    conn = duckdb.connect(str(db_path), read_only=True)
    try:
        rows = conn.execute(
            """
            SELECT seq_id, ticker, regime, parquet_uri, snapshot_sha256,
                   prev_merkle_hash, receipt_sha256, decision_json
            FROM audit_receipts
            ORDER BY seq_id ASC
            """
        ).fetchall()
    finally:
        conn.close()

    expected_prev = GENESIS_PREV_HASH
    errors: list[str] = []
    head_hash = GENESIS_PREV_HASH

    for row in rows:
        (
            seq_id,
            ticker,
            regime,
            parquet_uri,
            snapshot_sha256,
            prev_merkle_hash,
            receipt_sha256,
            decision_json,
        ) = row

        if prev_merkle_hash != expected_prev:
            errors.append(
                f"Block #{seq_id} ({ticker}): prev_merkle_hash mismatch "
                f"(expected {expected_prev}, got {prev_merkle_hash})"
            )

        recomputed_receipt = compute_merkle_receipt_hash(
            prev_merkle_hash=prev_merkle_hash,
            snapshot_sha256=snapshot_sha256,
            decision_canonical_json=decision_json,
        )
        if recomputed_receipt != receipt_sha256:
            errors.append(
                f"Block #{seq_id} ({ticker}): receipt_sha256 tamper detected "
                f"(expected {recomputed_receipt}, stored {receipt_sha256})"
            )

        pq_file = Path(parquet_uri)
        if not pq_file.exists():
            errors.append(f"Block #{seq_id} ({ticker}): missing Parquet snapshot at {parquet_uri}")
        else:
            actual_pq_sha = compute_sha256_bytes(pq_file.read_bytes())
            if actual_pq_sha != snapshot_sha256:
                errors.append(
                    f"Block #{seq_id} ({ticker}): Parquet byte hash mismatch "
                    f"(expected {snapshot_sha256}, actual {actual_pq_sha})"
                )

        expected_prev = receipt_sha256
        head_hash = receipt_sha256

    return {
        "valid": len(errors) == 0,
        "total_receipts": len(rows),
        "head_receipt_sha256": head_hash,
        "errors": errors,
    }


@mcp.tool()
def list_audit_receipts(vault_dir: str = "audit_vault", limit: int = 50) -> list[dict[str, Any]]:
    """Return recent Merkle audit receipts from `audit_ledger.duckdb`."""
    db_path = Path(vault_dir) / "audit_ledger.duckdb"
    if not db_path.exists():
        return []

    conn = duckdb.connect(str(db_path), read_only=True)
    try:
        rows = conn.execute(
            """
            SELECT seq_id, created_at_utc, ticker, regime, action, approved_lots,
                   sheaf_phi, h_arb, entry_limit_rp, take_profit_rp, stop_loss_pre_arb_rp,
                   parquet_uri, snapshot_sha256, prev_merkle_hash, receipt_sha256, decision_json
            FROM audit_receipts
            ORDER BY seq_id DESC
            LIMIT ?
            """,
            [limit],
        ).fetchall()
    finally:
        conn.close()

    results: list[dict[str, Any]] = []
    for r in rows:
        decision_obj = json.loads(r[15])
        decision_obj["receipt_sha256"] = r[14]
        decision_obj["prev_merkle_hash"] = r[13]
        decision_obj["seq_id"] = int(r[0])
        decision_obj["created_at_utc"] = r[1]
        results.append(
            {
                "seq_id": int(r[0]),
                "created_at_utc": r[1],
                "ticker": r[2],
                "regime": r[3],
                "action": r[4],
                "approved_lots": int(r[5]),
                "sheaf_phi": float(r[6]),
                "h_arb": float(r[7]),
                "entry_limit_rp": int(r[8]),
                "take_profit_rp": int(r[9]),
                "stop_loss_pre_arb_rp": int(r[10]),
                "parquet_uri": r[11],
                "snapshot_sha256": r[12],
                "prev_merkle_hash": r[13],
                "receipt_sha256": r[14],
                "decision": decision_obj,
            }
        )
    return results


def _sync_json_mirror(vault_dir: str = "audit_vault") -> None:
    """Write a JSON mirror of the verified ledger for fast Next.js API consumption."""
    receipts = list_audit_receipts(vault_dir=vault_dir, limit=100)
    verification = verify_merkle_chain(vault_dir=vault_dir)
    mirror_path = Path(vault_dir) / "latest_receipts.json"
    mirror_path.write_text(
        json.dumps(
            {
                "updated_at_utc": datetime.now(timezone.utc).isoformat(),
                "verification": verification,
                "receipts": receipts,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    mcp.run()
