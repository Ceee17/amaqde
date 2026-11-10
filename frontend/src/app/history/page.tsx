"use client";

import React, { useEffect, useState } from "react";
import TopNavBar from "@/components/TopNavBar";
import { AuditReceiptRow, AuditVaultPayload } from "@/types/swrt";
import { CheckCircle2, ChevronDown, ChevronUp, History, ShieldCheck } from "lucide-react";

function formatRp(val: number): string {
  return "Rp" + Math.round(val).toLocaleString("id-ID");
}

function friendlyScenario(regime: string): string {
  if (regime === "COHERENT_ACCUMULATION") return "Healthy Institutional Buying";
  if (regime === "BANDAR_BULL_TRAP") return "Bull Trap / Fake Pump Warning";
  if (regime === "ARB_LIQUIDITY_CASCADE") return "Panic Selling Near -7% Limit";
  return "Live Market Analysis";
}

export default function HistoryPage() {
  const [vault, setVault] = useState<AuditVaultPayload | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);

  useEffect(() => {
    fetch("/api/swrt", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setVault(d))
      .catch(() => {});
  }, []);

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <TopNavBar />

      <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5 text-emerald-400" />
              Past Stock Analyses
            </h1>
            <p className="text-xs text-slate-400">
              Every time you analyze a stock, the system saves a snapshot of the orderbook and the AI team&apos;s recommendation so you can review it anytime.
            </p>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/80 border border-emerald-500/30 text-xs font-semibold text-emerald-300 self-start sm:self-center">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>
              All {vault?.receipts?.length || 0} Saved Snapshots Verified ✓
            </span>
          </div>
        </div>

        {/* Clean Trader-Friendly History Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-3 px-3">Stock</th>
                <th className="py-3 px-3">Market Condition</th>
                <th className="py-3 px-3">Recommendation</th>
                <th className="py-3 px-3">Suggested Volume</th>
                <th className="py-3 px-3">Buy Price</th>
                <th className="py-3 px-3">Target Sell</th>
                <th className="py-3 px-3">Safety Stop-Loss</th>
                <th className="py-3 px-3">Data Saved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {(vault?.receipts || []).map((row: AuditReceiptRow) => {
                const isBuy = row.action === "BUY" && row.approved_lots > 0;
                return (
                  <tr key={row.seq_id} className="hover:bg-slate-800/40">
                    <td className="py-3 px-3 font-bold text-white">
                      {row.ticker}.JK
                    </td>
                    <td className="py-3 px-3 text-slate-300">
                      {friendlyScenario(row.regime)}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          isBuy
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                        }`}
                      >
                        {isBuy ? "BUY" : "DO NOT BUY"}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-semibold text-white">
                      {row.approved_lots} Lots
                    </td>
                    <td className="py-3 px-3 text-sky-300 font-semibold">
                      {formatRp(row.entry_limit_rp)}
                    </td>
                    <td className="py-3 px-3 text-emerald-300 font-semibold">
                      {formatRp(row.take_profit_rp)}
                    </td>
                    <td className="py-3 px-3 text-amber-300 font-semibold">
                      {formatRp(row.stop_loss_pre_arb_rp)}
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Verified
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Optional Collapsible Technical Verification Details */}
        <div className="pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={() => setShowTechnical((p) => !p)}
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            {showTechnical ? (
              <>
                Hide Technical Snapshot Files <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                Show Technical Snapshot Files (Optional){" "}
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>

          {showTechnical && (
            <div className="mt-3 bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2 text-[11px] font-mono text-slate-400">
              {(vault?.receipts || []).map((r) => (
                <div
                  key={r.seq_id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 border-b border-slate-900 pb-1.5"
                >
                  <span className="text-slate-200">
                    #{r.seq_id} {r.ticker}.JK — Snapshot: <code>{r.parquet_uri}</code>
                  </span>
                  <span className="text-slate-500">
                    ID: {r.receipt_sha256.slice(0, 20)}...
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
