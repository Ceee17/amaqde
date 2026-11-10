"use client";

import React, { useState } from "react";
import { AuditReceiptRow, UnifiedDecisionCard } from "@/types/swrt";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle,
  Copy,
  Database,
  FileSpreadsheet,
  Flame,
  Hash,
  Layers,
  Link2,
  Lock,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Workflow,
} from "lucide-react";

interface Props {
  activeCard: UnifiedDecisionCard;
  receipts: AuditReceiptRow[];
  verification: {
    valid: boolean;
    total_receipts: number;
    head_receipt_sha256: string;
    errors: string[];
  };
  onSelectReceipt: (row: AuditReceiptRow) => void;
}

export default function ForensicAuditInspector({
  activeCard,
  receipts,
  verification,
  onSelectReceipt,
}: Props) {
  const [activeTab, setActiveTab] = useState<"crypto" | "bdm" | "lob">("crypto");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2000);
      }
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };

  // Sort receipts chronologically ascending by seq_id for the topology chain
  const sortedReceipts = [...receipts].sort(
    (a, b) => (a.seq_id ?? 0) - (b.seq_id ?? 0)
  );

  // Pillar 1: Sinkhorn-Knopp BDM Diagnostics
  const bdmDiag = activeCard.stalks?.BDM?.diagnostics || {};
  const convictionKappa = Number(bdmDiag.conviction_kappa ?? 0.0);
  const retailToInstFlow = Number(bdmDiag.retail_to_inst_flow ?? 0.0);
  const instToRetailFlow = Number(bdmDiag.inst_to_retail_flow ?? 0.0);
  const selfLoopWashRatio = Number(bdmDiag.self_loop_wash_ratio ?? 0.0);
  const sinkhornDivergence = Number(bdmDiag.sinkhorn_divergence ?? 0.0);
  const top3BuyConc = Number(bdmDiag.top3_buy_concentration ?? 0.0);
  const top3SellConc = Number(bdmDiag.top3_sell_concentration ?? 0.0);
  const netInstPressure = Number(bdmDiag.net_inst_pressure ?? 0.0);
  const transportMatrix: number[][] = Array.isArray(bdmDiag.transport_matrix)
    ? bdmDiag.transport_matrix
    : [];

  const bdmFlat = transportMatrix.flat();
  const maxTransportVal = bdmFlat.length > 0 ? Math.max(...bdmFlat, 0.001) : 1;
  const bdmRowSums = transportMatrix.map((row) =>
    row.reduce((acc, v) => acc + (Number(v) || 0), 0)
  );
  const bdmColSums =
    transportMatrix.length > 0
      ? transportMatrix[0].map((_, cIdx) =>
          transportMatrix.reduce((acc, row) => acc + (Number(row[cIdx]) || 0), 0)
        )
      : [];

  // Pillar 2: Rough Path LOB Diagnostics
  const lobDiag = activeCard.stalks?.LOB?.diagnostics || {};
  const s1Vector: number[] = Array.isArray(lobDiag.s1_vector)
    ? lobDiag.s1_vector
    : [0, 0, 0];
  const levyMatrix: number[][] = Array.isArray(lobDiag.levy_area_matrix)
    ? lobDiag.levy_area_matrix
    : [];
  const levyOfiCancel = Number(lobDiag.levy_ofi_cancel ?? 0.0);
  const spoofingDetected = Boolean(lobDiag.spoofing_detected);
  const spoofingIntensity = Number(lobDiag.spoofing_intensity ?? 0.0);
  const bookImbalance = Number(lobDiag.book_imbalance ?? 0.0);
  const distToArbPct = Number(lobDiag.dist_to_arb_pct ?? 0.0);
  const depth3PriceCubic = Number(lobDiag.depth3_price_cubic ?? 0.0);
  const levyPriceOfi = Number(lobDiag.levy_price_ofi ?? 0.0);

  const tierNames = ["Tier 1 (Inst)", "Tier 2 (Semi)", "Tier 3 (Retail)"];
  const lobDimensionLabels = ["Price (P)", "OFI (O)", "Cancel (C)"];

  return (
    <div
      className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex flex-col gap-5 shadow-2xl"
      data-testid="forensic-audit-inspector"
    >
      {/* 1. Header & Merkle Chain Verification Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-100 tracking-wide flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-400" />
            FORENSIC MERKLE AUDIT INSPECTOR (audit_ledger.duckdb)
          </h2>
          <p className="text-xs text-slate-400">
            Immutable SHA-256 Hash-Chained Ledger &amp; Frozen <code>zstd</code> Parquet Microstructure Snapshots
          </p>
        </div>

        <div
          className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold flex items-center gap-2 ${
            verification.valid
              ? "bg-emerald-950/70 border-emerald-500/60 text-emerald-300"
              : "bg-rose-950/70 border-rose-500/60 text-rose-300"
          }`}
          data-testid="merkle-chain-status"
        >
          {verification.valid ? (
            <>
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>MERKLE CHAIN VERIFIED ({verification.total_receipts} BLOCKS)</span>
            </>
          ) : (
            <>
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>TAMPER DETECTED ({verification.errors.length} ERRORS)</span>
            </>
          )}
        </div>
      </div>

      {/* 2. Visual SHA-256 Merkle Hash Chain Topology Bar */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5 text-cyan-400" />
            Cryptographic SHA-256 Hash Chain Topology
          </span>
          <span className="text-[11px] text-slate-400">
            Click any block to inspect its radar &amp; telemetry
          </span>
        </div>

        <div className="overflow-x-auto pb-2 pt-1">
          <div className="flex items-center gap-2 min-w-max">
            {/* Genesis Block */}
            <div className="flex items-center gap-2">
              <div className="border border-slate-700/80 bg-slate-950/90 rounded-lg p-2.5 min-w-[190px] shadow-sm select-none">
                <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-400 border-b border-slate-800 pb-1 mb-1.5">
                  <span className="flex items-center gap-1">
                    <Lock className="w-3 h-3 text-slate-500" />
                    BLOCK #0
                  </span>
                  <span className="text-cyan-400">GENESIS</span>
                </div>
                <div className="font-mono text-[11px] text-slate-300 font-semibold truncate">
                  0000000000000000...
                </div>
                <div className="text-[10px] text-slate-500 font-mono mt-1">
                  Root Genesis Block
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-600 shrink-0" />
            </div>

            {/* Chained Receipt Blocks */}
            {sortedReceipts.map((row, index) => {
              const isSelected = row.receipt_sha256 === activeCard.receipt_sha256;
              const expectedPrevHash =
                index === 0
                  ? "0".repeat(64)
                  : sortedReceipts[index - 1].receipt_sha256;
              const isLinkValid =
                row.prev_merkle_hash.toLowerCase() ===
                expectedPrevHash.toLowerCase();

              return (
                <React.Fragment key={row.seq_id}>
                  <button
                    onClick={() => onSelectReceipt(row)}
                    className={`text-left border rounded-lg p-2.5 min-w-[210px] transition-all cursor-pointer ${
                      isSelected
                        ? "border-cyan-400 bg-cyan-950/50 shadow-lg shadow-cyan-950/50 ring-1 ring-cyan-400"
                        : "border-slate-800 bg-slate-950/80 hover:border-slate-700 hover:bg-slate-900/60"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono font-bold border-b border-slate-800/80 pb-1 mb-1.5">
                      <span className="text-cyan-400">
                        #{row.seq_id} {row.ticker}.JK
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          row.action === "BUY"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-600/50"
                            : row.action === "AVOID_ARB_HAZARD"
                            ? "bg-amber-950 text-amber-300 border border-amber-600/50"
                            : "bg-rose-950 text-rose-300 border border-rose-600/50"
                        }`}
                      >
                        {row.action}
                      </span>
                    </div>

                    <div className="font-mono text-[11px] text-emerald-300 truncate font-semibold">
                      {row.receipt_sha256.slice(0, 10)}...{row.receipt_sha256.slice(-6)}
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-1">
                      <span className="truncate max-w-[130px]">
                        prev: {row.prev_merkle_hash.slice(0, 6)}...
                      </span>
                      {isLinkValid ? (
                        <span className="text-emerald-400 flex items-center gap-0.5 text-[9px] font-bold">
                          <Check className="w-2.5 h-2.5" /> LINKED
                        </span>
                      ) : (
                        <span className="text-rose-400 flex items-center gap-0.5 text-[9px] font-bold">
                          <AlertTriangle className="w-2.5 h-2.5" /> MISMATCH
                        </span>
                      )}
                    </div>
                  </button>

                  {index < sortedReceipts.length - 1 && (
                    <ArrowRight className="w-4 h-4 text-cyan-500/70 shrink-0" />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3. Deep-Dive Pillar Telemetry Inspector: Tab Selector */}
      <div className="border border-slate-800 rounded-xl bg-slate-950/70 overflow-hidden">
        <div className="flex items-center border-b border-slate-800 bg-slate-950/90 text-xs font-mono">
          <button
            onClick={() => setActiveTab("crypto")}
            className={`px-4 py-3 flex items-center gap-2 transition-all font-semibold border-b-2 ${
              activeTab === "crypto"
                ? "border-cyan-400 text-cyan-300 bg-slate-900/90"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span>Cryptographic Proof &amp; Merkle Receipt</span>
          </button>

          <button
            onClick={() => setActiveTab("bdm")}
            className={`px-4 py-3 flex items-center gap-2 transition-all font-semibold border-b-2 ${
              activeTab === "bdm"
                ? "border-emerald-400 text-emerald-300 bg-slate-900/90"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
            }`}
          >
            <Workflow className="w-3.5 h-3.5 text-emerald-400" />
            <span>Pillar 1: Sinkhorn-Knopp OT (BDM)</span>
          </button>

          <button
            onClick={() => setActiveTab("lob")}
            className={`px-4 py-3 flex items-center gap-2 transition-all font-semibold border-b-2 ${
              activeTab === "lob"
                ? "border-amber-400 text-amber-300 bg-slate-900/90"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            <span>Pillar 2: Rough Path &amp; L&eacute;vy Area (LOB)</span>
          </button>
        </div>

        {/* Tab / Panel A — Cryptographic Receipt & Parquet Proof */}
        {/* Note: Kept always mounted via CSS hidden so automated tests can always query the testid elements */}
        <div className={activeTab === "crypto" ? "p-4 space-y-4" : "hidden"}>
          {/* Visual Formula Badge */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-cyan-950/30 border border-cyan-800/40 rounded-lg px-3.5 py-2 text-xs font-mono">
            <div className="flex items-center gap-2 text-cyan-300 font-semibold">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>SHA-256 Merkle Chaining Invariant:</span>
            </div>
            <code className="text-[11px] text-cyan-200 bg-slate-900/90 px-2.5 py-1 rounded border border-cyan-700/50">
              SHA256(prev_merkle_hash || &quot;|&quot; || snapshot_sha256 || &quot;|&quot; || canonical_decision_json)
            </code>
          </div>

          {/* Cryptographic Digest Box with Copy Buttons */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 bg-slate-950/90 border border-slate-800 rounded-lg p-3.5 text-xs font-mono">
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between text-slate-400 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-emerald-400" />
                    Active Receipt SHA-256 (Block #{activeCard.seq_id || 1}):
                  </span>
                  <button
                    onClick={() =>
                      handleCopy(activeCard.receipt_sha256, "receipt")
                    }
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-emerald-300 transition-colors"
                    title="Copy Active Receipt SHA-256"
                  >
                    {copiedKey === "receipt" ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedKey === "receipt" ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <div
                  className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-emerald-300 break-all select-all text-[11px]"
                  data-testid="active-receipt-sha256"
                >
                  {activeCard.receipt_sha256}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-slate-400 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-cyan-400" />
                    Previous Merkle Block Hash:
                  </span>
                  <button
                    onClick={() =>
                      handleCopy(activeCard.prev_merkle_hash, "prev_hash")
                    }
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-cyan-300 transition-colors"
                    title="Copy Previous Merkle Hash"
                  >
                    {copiedKey === "prev_hash" ? (
                      <Check className="w-3 h-3 text-cyan-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedKey === "prev_hash" ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-slate-400 break-all text-[11px]">
                  {activeCard.prev_merkle_hash}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between text-slate-400 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-amber-400" />
                    Frozen Parquet Snapshot SHA-256:
                  </span>
                  <button
                    onClick={() =>
                      handleCopy(activeCard.snapshot_sha256, "snapshot")
                    }
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-amber-300 transition-colors"
                    title="Copy Snapshot SHA-256"
                  >
                    {copiedKey === "snapshot" ? (
                      <Check className="w-3 h-3 text-amber-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedKey === "snapshot" ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <div
                  className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-amber-300 break-all select-all text-[11px]"
                  data-testid="active-snapshot-sha256"
                >
                  {activeCard.snapshot_sha256}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-slate-400 mb-1">
                  <span className="flex items-center gap-1.5">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-purple-400" />
                    Frozen Raw L2 + Broker Parquet Artifact URI:
                  </span>
                  <button
                    onClick={() =>
                      handleCopy(activeCard.parquet_uri, "parquet")
                    }
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-purple-300 transition-colors"
                    title="Copy Parquet URI"
                  >
                    {copiedKey === "parquet" ? (
                      <Check className="w-3 h-3 text-purple-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedKey === "parquet" ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <div
                  className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-purple-300 break-all text-[11px]"
                  data-testid="active-parquet-uri"
                >
                  {activeCard.parquet_uri}
                </div>
              </div>
            </div>
          </div>

          {/* Cryptographic Ledger Provenance Metadata */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="bg-slate-900/60 border border-slate-800 rounded p-2.5">
              <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">
                Head Receipt SHA-256
              </span>
              <span className="text-slate-300 text-[11px] truncate block font-bold">
                {verification.head_receipt_sha256.slice(0, 16)}...
              </span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded p-2.5">
              <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">
                Chain Verification
              </span>
              <span
                className={`text-[11px] font-bold ${
                  verification.valid ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {verification.valid ? "VALID & IMMUTABLE" : "CORRUPTED CHAIN"}
              </span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded p-2.5">
              <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">
                Database Engine
              </span>
              <span className="text-cyan-300 text-[11px] font-bold">
                DuckDB (audit_ledger.duckdb)
              </span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded p-2.5">
              <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">
                Compression Codec
              </span>
              <span className="text-purple-300 text-[11px] font-bold">
                Parquet zstd Level 9
              </span>
            </div>
          </div>
        </div>

        {/* Tab / Panel B — Pillar 1 Sinkhorn-Knopp Optimal Transport Coupling (BDM Diagnostics) */}
        <div className={activeTab === "bdm" ? "p-4 space-y-4" : "hidden"}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div>
              <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Workflow className="w-4 h-4" />
                Pillar 1: Sinkhorn-Knopp Entropic Optimal Transport Coupling (&Gamma;*)
              </h3>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                {activeCard.stalks?.BDM?.summary_rationale ||
                  "Intraday broker summary optimal transport matrix."}
              </p>
            </div>
            <div className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2.5 py-1 rounded border border-slate-800">
              Entropy &epsilon; = 0.08 &bull; Convergence Tolerance = 1e-7
            </div>
          </div>

          {/* Key BDM Diagnostics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs font-mono">
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                Conviction &kappa;
              </span>
              <span
                className={`text-sm font-extrabold ${
                  convictionKappa > 0.3
                    ? "text-emerald-400"
                    : convictionKappa < -0.3
                    ? "text-rose-400"
                    : "text-slate-300"
                }`}
              >
                {convictionKappa > 0
                  ? `+${convictionKappa.toFixed(2)}`
                  : convictionKappa.toFixed(2)}
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                Retail &rarr; Inst Flow
              </span>
              <span className="text-sm font-extrabold text-emerald-400">
                {(retailToInstFlow * 100).toFixed(1)}%
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                Inst &rarr; Retail Flow
              </span>
              <span
                className={`text-sm font-extrabold ${
                  instToRetailFlow > 0.5 ? "text-rose-400" : "text-slate-300"
                }`}
              >
                {(instToRetailFlow * 100).toFixed(1)}%
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                Wash Ratio
              </span>
              <span
                className={`text-sm font-extrabold ${
                  selfLoopWashRatio > 0.25 ? "text-amber-400" : "text-slate-300"
                }`}
              >
                {(selfLoopWashRatio * 100).toFixed(2)}%
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                Sinkhorn Div (W_&epsilon;)
              </span>
              <span className="text-sm font-extrabold text-cyan-400">
                {sinkhornDivergence.toFixed(4)}
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                Top3 Buy Conc
              </span>
              <span className="text-sm font-extrabold text-purple-300">
                {(top3BuyConc * 100).toFixed(1)}%
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                Top3 Sell Conc
              </span>
              <span className="text-sm font-extrabold text-purple-300">
                {(top3SellConc * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Visual Heat-Table of transport_matrix (\Gamma^*) */}
          {transportMatrix.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                <span className="font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  Optimal Coupling Heat Matrix &Gamma;* (Row = Seller Tier, Col = Buyer Tier)
                </span>
                <span className="text-[11px]">
                  Net Inst Pressure: {netInstPressure > 0 ? `+${netInstPressure.toFixed(2)}` : netInstPressure.toFixed(2)}
                </span>
              </div>

              <div className="overflow-x-auto border border-slate-800 rounded-lg">
                <table className="w-full text-center border-collapse text-xs font-mono">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                      <th className="py-2 px-3 text-left">Seller \ Buyer</th>
                      {transportMatrix[0].map((_, cIdx) => (
                        <th key={cIdx} className="py-2 px-3">
                          {tierNames[cIdx] || `Buyer #${cIdx + 1}`}
                        </th>
                      ))}
                      <th className="py-2 px-3 text-cyan-400 font-bold">
                        Marginal &nu; (Sell)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {transportMatrix.map((row, rIdx) => (
                      <tr key={rIdx}>
                        <td className="py-2.5 px-3 font-semibold text-slate-300 text-left bg-slate-950/80">
                          {tierNames[rIdx] || `Seller #${rIdx + 1}`}
                        </td>
                        {row.map((cellVal, cIdx) => {
                          const val = Number(cellVal) || 0;
                          const intensity = maxTransportVal > 0 ? val / maxTransportVal : 0;
                          const cellBg =
                            intensity > 0.7
                              ? "bg-emerald-950/60 text-emerald-200 font-bold border-emerald-700/40"
                              : intensity > 0.35
                              ? "bg-cyan-950/40 text-cyan-300 font-semibold border-cyan-800/30"
                              : intensity > 0.1
                              ? "bg-slate-900/80 text-slate-300 border-slate-800"
                              : "bg-slate-950 text-slate-500 border-slate-900";

                          return (
                            <td
                              key={cIdx}
                              className={`py-2.5 px-3 border ${cellBg}`}
                              title={`Seller ${tierNames[rIdx] || rIdx} -> Buyer ${tierNames[cIdx] || cIdx}: ${val.toFixed(5)}`}
                            >
                              <div className="font-bold">{(val * 100).toFixed(2)}%</div>
                              <div className="text-[10px] opacity-75 font-mono">{val.toFixed(4)}</div>
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-3 font-bold text-cyan-300 bg-slate-950/80">
                          {((bdmRowSums[rIdx] || 0) * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                    {/* Column Marginals Row */}
                    <tr className="bg-slate-950/90 border-t-2 border-slate-800 font-bold">
                      <td className="py-2 px-3 text-left text-cyan-400 font-bold">
                        Marginal &mu; (Buy)
                      </td>
                      {bdmColSums.map((sumVal, cIdx) => (
                        <td key={cIdx} className="py-2 px-3 text-cyan-300">
                          {(sumVal * 100).toFixed(1)}%
                        </td>
                      ))}
                      <td className="py-2 px-3 text-emerald-400">
                        100.0%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-500 font-mono italic p-4 text-center">
              No Sinkhorn transport matrix available for this ticker.
            </div>
          )}
        </div>

        {/* Tab / Panel C — Pillar 2 Depth-3 Rough Path Signature & Lévy Area (LOB Diagnostics) */}
        <div className={activeTab === "lob" ? "p-4 space-y-4" : "hidden"}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div>
              <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Activity className="w-4 h-4" />
                Pillar 2: Depth-3 Rough Path Signature &amp; L&eacute;vy Area Tensor
              </h3>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                {activeCard.stalks?.LOB?.summary_rationale ||
                  "Depth-3 rough path signature and microstructure spoofing detection."}
              </p>
            </div>

            <div
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold flex items-center gap-1.5 border ${
                spoofingDetected
                  ? "bg-rose-950/80 border-rose-500/60 text-rose-300 animate-pulse"
                  : "bg-emerald-950/70 border-emerald-500/60 text-emerald-300"
              }`}
            >
              {spoofingDetected ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                  <span>PHANTOM BID WALL SPOOFING DETECTED</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>GENUINE ORDERBOOK RESILIENCE</span>
                </>
              )}
            </div>
          </div>

          {/* Key LOB Diagnostics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 text-xs font-mono">
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                L2 Book Imbalance
              </span>
              <span
                className={`text-sm font-extrabold ${
                  bookImbalance > 0.2
                    ? "text-emerald-400"
                    : bookImbalance < -0.2
                    ? "text-rose-400"
                    : "text-slate-300"
                }`}
              >
                {bookImbalance > 0
                  ? `+${(bookImbalance * 100).toFixed(1)}%`
                  : `${(bookImbalance * 100).toFixed(1)}%`}
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                Dist to -7% ARB
              </span>
              <span
                className={`text-sm font-extrabold ${
                  distToArbPct < 0.015 ? "text-rose-400 font-black" : "text-amber-300"
                }`}
              >
                {(distToArbPct * 100).toFixed(2)}%
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                L&eacute;vy Area A(OFI,Cancel)
              </span>
              <span
                className={`text-sm font-extrabold ${
                  levyOfiCancel < -0.5 ? "text-rose-400" : "text-cyan-300"
                }`}
              >
                {levyOfiCancel > 0 ? `+${levyOfiCancel.toFixed(4)}` : levyOfiCancel.toFixed(4)}
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                L&eacute;vy Area A(Price,OFI)
              </span>
              <span className="text-sm font-extrabold text-cyan-300">
                {levyPriceOfi > 0 ? `+${levyPriceOfi.toFixed(4)}` : levyPriceOfi.toFixed(4)}
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                Depth-3 Price Cubic S(1,1,1)
              </span>
              <span className="text-sm font-extrabold text-purple-300">
                {depth3PriceCubic.toFixed(4)}
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">
                h_ARB Hazard
              </span>
              <span
                className={`text-sm font-extrabold ${
                  (activeCard.stalks?.LOB?.h_arb ?? 0) > 0.65 ? "text-rose-400" : "text-emerald-400"
                }`}
              >
                {((activeCard.stalks?.LOB?.h_arb ?? 0) * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Level 1 Signature Vector & 3x3 Lévy Area Matrix */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
            {/* Level 1 Signature Vector Coordinates */}
            <div className="lg:col-span-5 bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-2">
              <div className="text-xs font-mono font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-amber-400" />
                Level 1 Signature Vector S^(1)
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Microstructure trajectory increments over 1,000 tick window:
              </p>

              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded">
                  <span className="text-slate-400">S^(1)[0] Normalized Price Drift:</span>
                  <span className="font-bold text-amber-300">
                    {(Number(s1Vector[0]) || 0).toFixed(4)}
                  </span>
                </div>
                <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded">
                  <span className="text-slate-400">S^(1)[1] Order Flow Imbalance:</span>
                  <span className="font-bold text-cyan-300">
                    {(Number(s1Vector[1]) || 0).toFixed(4)}
                  </span>
                </div>
                <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded">
                  <span className="text-slate-400">S^(1)[2] Cancellation Velocity:</span>
                  <span className="font-bold text-purple-300">
                    {(Number(s1Vector[2]) || 0).toFixed(4)}
                  </span>
                </div>
              </div>

              <div className="text-[10px] text-slate-500 font-mono pt-1">
                Coordinates extracted via Chen&apos;s iterated integral identity over path X_t = (Price_t, OFI_t, Cancel_t).
              </div>
            </div>

            {/* Visual 3x3 Anti-Symmetric Lévy Area Matrix */}
            <div className="lg:col-span-7 bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-2">
              <div className="text-xs font-mono font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-rose-400" />
                  3&times;3 L&eacute;vy Area Tensor A_ij = 0.5 &bull; (S^(i,j) - S^(j,i))
                </span>
                <span className="text-[10px] text-slate-500">Anti-Symmetric</span>
              </div>

              {levyMatrix.length > 0 ? (
                <div className="overflow-x-auto border border-slate-800 rounded">
                  <table className="w-full text-center border-collapse text-xs font-mono">
                    <thead>
                      <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                        <th className="py-2 px-2.5 text-left text-[11px]">Channel</th>
                        {lobDimensionLabels.map((lbl, idx) => (
                          <th key={idx} className="py-2 px-2.5 text-[11px]">
                            {lbl}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {levyMatrix.map((row, rIdx) => (
                        <tr key={rIdx}>
                          <td className="py-2 px-2.5 font-semibold text-slate-300 text-left bg-slate-950/90">
                            {lobDimensionLabels[rIdx] || `Dim #${rIdx}`}
                          </td>
                          {row.map((val, cIdx) => {
                            const num = Number(val) || 0;
                            const isDiag = rIdx === cIdx;
                            const isOfiCancel =
                              (rIdx === 1 && cIdx === 2) || (rIdx === 2 && cIdx === 1);

                            let cellStyle = "text-slate-500 bg-slate-950";
                            if (!isDiag) {
                              if (isOfiCancel && num < -0.5) {
                                cellStyle =
                                  "text-rose-300 bg-rose-950/50 font-extrabold border-rose-700/50";
                              } else if (num > 0) {
                                cellStyle =
                                  "text-emerald-300 bg-emerald-950/30 font-semibold";
                              } else if (num < 0) {
                                cellStyle =
                                  "text-amber-300 bg-amber-950/30 font-semibold";
                              }
                            }

                            return (
                              <td
                                key={cIdx}
                                className={`py-2 px-2.5 border border-slate-900 ${cellStyle}`}
                                title={`Lévy Area [${lobDimensionLabels[rIdx]} -> ${lobDimensionLabels[cIdx]}]: ${num.toFixed(5)}`}
                              >
                                {isDiag
                                  ? "0.0000"
                                  : num > 0
                                  ? `+${num.toFixed(4)}`
                                  : num.toFixed(4)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-xs text-slate-500 font-mono italic p-3 text-center">
                  No L&eacute;vy Area matrix available.
                </div>
              )}

              <p className="text-[10px] text-slate-500 font-mono">
                Large negative values in A(OFI, Cancel) signify non-commutative lead-lag phase loops indicative of algorithmic spoofing.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Enhanced DuckDB Immutable Receipt Chain Table */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 font-mono">
          <span className="flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            DuckDB Immutable Receipt Chain (Click any block to inspect in 3D Tensegrity Radar)
          </span>
          <span className="text-[11px] text-slate-500 font-normal">
            Total Blocks: {receipts.length}
          </span>
        </div>

        <div className="overflow-x-auto border border-slate-800 rounded-lg">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Block</th>
                <th className="py-2.5 px-3">Ticker</th>
                <th className="py-2.5 px-3">Regime</th>
                <th className="py-2.5 px-3">Action</th>
                <th className="py-2.5 px-3">Lots</th>
                <th className="py-2.5 px-3">Entry (Rp)</th>
                <th className="py-2.5 px-3">TP (Rp)</th>
                <th className="py-2.5 px-3">Pre-ARB SL (Rp)</th>
                <th className="py-2.5 px-3">&Phi;(x)</th>
                <th className="py-2.5 px-3">h_ARB</th>
                <th className="py-2.5 px-3">Receipt SHA-256</th>
                <th className="py-2.5 px-3">Parquet Snapshot</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {receipts.map((row) => {
                const isSelected = row.receipt_sha256 === activeCard.receipt_sha256;
                const entryRp = row.entry_limit_rp ?? row.decision?.entry_limit_rp ?? 0;
                const tpRp = row.take_profit_rp ?? row.decision?.take_profit_rp ?? 0;
                const slRp = row.stop_loss_pre_arb_rp ?? row.decision?.stop_loss_pre_arb_rp ?? 0;

                return (
                  <tr
                    key={row.seq_id}
                    onClick={() => onSelectReceipt(row)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-cyan-950/40 text-white font-medium"
                        : "bg-slate-900/40 hover:bg-slate-800/60 text-slate-300"
                    }`}
                    data-testid={`receipt-row-${row.ticker}-${row.regime}`}
                  >
                    {/* Status Column */}
                    <td className="py-2.5 px-3">
                      {isSelected ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-500/60">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                          ACTIVE
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-950 text-slate-500 border border-slate-800">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                          IDLE
                        </span>
                      )}
                    </td>

                    <td className="py-2.5 px-3 font-bold text-cyan-400">#{row.seq_id}</td>
                    <td className="py-2.5 px-3 font-bold text-white">{row.ticker}.JK</td>
                    <td className="py-2.5 px-3 text-slate-300">{row.regime}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          row.action === "BUY"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-700/60"
                            : row.action === "AVOID_ARB_HAZARD"
                            ? "bg-amber-950 text-amber-300 border border-amber-700/60"
                            : "bg-rose-950 text-rose-300 border border-rose-700/60"
                        }`}
                      >
                        {row.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-bold">{row.approved_lots}</td>

                    {/* Entry / TP / Pre-ARB SL Columns */}
                    <td className="py-2.5 px-3 text-cyan-300 font-semibold">
                      {entryRp > 0 ? `Rp${entryRp.toLocaleString("id-ID")}` : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-emerald-300 font-semibold">
                      {tpRp > 0 ? `Rp${tpRp.toLocaleString("id-ID")}` : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-rose-300 font-semibold">
                      {slRp > 0 ? `Rp${slRp.toLocaleString("id-ID")}` : "—"}
                    </td>

                    <td
                      className={`py-2.5 px-3 font-bold ${
                        row.sheaf_phi > 0.7 ? "text-rose-400" : "text-emerald-400"
                      }`}
                    >
                      {row.sheaf_phi.toFixed(4)}
                    </td>
                    <td
                      className={`py-2.5 px-3 ${
                        row.h_arb > 0.65 ? "text-rose-400 font-bold" : "text-slate-300"
                      }`}
                    >
                      {(row.h_arb * 100).toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-3 text-emerald-300">
                      {row.receipt_sha256.slice(0, 10)}&hellip;{row.receipt_sha256.slice(-6)}
                    </td>
                    <td className="py-2.5 px-3 text-purple-300 truncate max-w-[180px]">
                      {row.parquet_uri.split("/").slice(-2).join("/")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
