"use client";

import React, { useState } from "react";
import { UnifiedDecisionCard } from "@/types/swrt";
import {
  Activity,
  AlertOctagon,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Compass,
  GitMerge,
  Layers,
  Lock,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

interface Props {
  card: UnifiedDecisionCard;
}

function formatRp(val: number): string {
  return `Rp${val.toLocaleString("id-ID")}`;
}

function formatMillionRp(val: number): string {
  if (val <= 0) return "Rp0";
  if (val >= 1_000_000_000) {
    return `Rp${(val / 1_000_000_000).toFixed(2)}B`;
  }
  return `Rp${(val / 1_000_000).toFixed(2)}M`;
}

export default function UnifiedDecisionSummaryBanner({ card }: Props) {
  const [copied, setCopied] = useState(false);

  const isBuy = card.action === "BUY" && card.approved_lots > 0;
  const isCohomologyBlocked = card.action === "BLOCKED_COHOMOLOGY" || card.cohomology_veto;
  const isArbBlocked = card.action === "AVOID_ARB_HAZARD" || card.h_arb > 0.65;

  const bdmKappa = Number(card.stalks?.BDM?.diagnostics?.conviction_kappa ?? card.stalks?.BDM?.mu_5d ?? 0);
  const instToInst = Number(card.stalks?.BDM?.diagnostics?.inst_to_inst_flow ?? 0) * 100;
  const instToRetail = Number(card.stalks?.BDM?.diagnostics?.inst_to_retail_flow ?? 0) * 100;
  const spoofingDetected = Boolean(card.stalks?.LOB?.diagnostics?.spoofing_detected);
  const levyArea = Number(card.stalks?.LOB?.diagnostics?.levy_price_ofi ?? 0);

  const handleCopyOrderTicket = async () => {
    const ticketText = `[IDX SWRT HITL TICKET] Ticker: ${card.ticker}.JK | Action: ${card.action} | Lots: ${card.approved_lots} (${card.approved_shares.toLocaleString("id-ID")} shs) | Entry: ${formatRp(card.entry_limit_rp)} | TP: ${formatRp(card.take_profit_rp)} (+${card.gross_tp_edge_pct.toFixed(2)}%) | Pre-ARB SL: ${formatRp(card.stop_loss_pre_arb_rp)} | Time-Stop: ${card.time_stop_date} | Φ(x): ${card.sheaf_phi.toFixed(4)} | h_ARB: ${(card.h_arb * 100).toFixed(1)}% | Merkle SHA256: ${card.receipt_sha256}`;
    try {
      await navigator.clipboard.writeText(ticketText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      // Fallback for non-secure contexts
      const textarea = document.createElement("textarea");
      textarea.value = ticketText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    }
  };

  const renderExecutiveSynthesis = () => {
    if (isBuy) {
      return (
        <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
          <span className="font-bold text-emerald-300">
            MATHEMATICAL EQUILIBRIUM CONFIRMED ({card.ticker}.JK):
          </span>{" "}
          All 4 specialist stalks (Bandar, LOB, Catalyst, Macro) converge in global section consensus with low Sheaf Cohomology Frustration{" "}
          <span className="font-mono font-semibold text-emerald-300">
            &Phi;(x) = {card.sheaf_phi.toFixed(4)} &le; {card.cohomology_threshold.toFixed(2)}
          </span>
          . Pillar 1 Sinkhorn Entropic OT verifies institutional accumulation (
          <span className="font-mono text-cyan-300">
            &kappa; = {bdmKappa >= 0 ? `+${bdmKappa.toFixed(2)}` : bdmKappa.toFixed(2)}
          </span>
          , Inst&rarr;Inst {instToInst.toFixed(0)}%) with benign ARB tail risk (
          <span className="font-mono text-emerald-300">
            h_ARB = {(card.h_arb * 100).toFixed(1)}%
          </span>
          ). Pillar 4 WDRO approves{" "}
          <span className="font-mono font-bold text-white">
            {card.approved_lots} Lots ({formatMillionRp(card.notional_exposure_rp)})
          </span>{" "}
          at tick-aligned limit{" "}
          <span className="font-mono font-bold text-cyan-300">
            {formatRp(card.entry_limit_rp)}
          </span>
          , targeting OU optimal stopping boundary{" "}
          <span className="font-mono font-bold text-emerald-300">
            {formatRp(card.take_profit_rp)} (+{card.gross_tp_edge_pct.toFixed(2)}%)
          </span>{" "}
          and protected by a Pre-ARB circuit breaker at{" "}
          <span className="font-mono font-bold text-amber-300">
            {formatRp(card.stop_loss_pre_arb_rp)}
          </span>
          .
        </p>
      );
    }

    if (isCohomologyBlocked) {
      return (
        <p className="text-xs sm:text-sm text-rose-100 leading-relaxed">
          <span className="font-bold text-rose-300">
            COHOMOLOGY CIRCUIT BREAKER — BANDAR BULL TRAP DETECTED ({card.ticker}.JK):
          </span>{" "}
          Cellular Sheaf Laplacian flags severe cross-agent structural disagreement{" "}
          <span className="font-mono font-bold text-rose-300">
            &Phi;(x) = {card.sheaf_phi.toFixed(4)} &gt; {card.cohomology_threshold.toFixed(2)}
          </span>{" "}
          along fault edge{" "}
          <span className="font-mono font-semibold text-amber-300">
            {card.primary_fault_edge} (||{card.primary_fault_norm.toFixed(3)}||)
          </span>
          . Retail catalyst sentiment is euphoric (
          <span className="font-mono text-emerald-300">
            NLP &mu;_5d = {card.stalks.NLP.mu_5d >= 0 ? `+${card.stalks.NLP.mu_5d.toFixed(2)}` : card.stalks.NLP.mu_5d.toFixed(2)}
          </span>
          ) while Sinkhorn OT exposes covert Bandar distribution into retail hands (
          <span className="font-mono text-rose-300">
            BDM &mu;_5d = {card.stalks.BDM.mu_5d.toFixed(2)}, Inst&rarr;Retail {instToRetail.toFixed(0)}%
          </span>
          ){spoofingDetected ? ` alongside LOB L\u00e9vy-area spoofing (${levyArea.toFixed(2)})` : ""}. WDRO forces{" "}
          <span className="font-mono font-bold text-rose-300">0 Lots (100% Cash Preservation)</span>.
        </p>
      );
    }

    if (isArbBlocked) {
      return (
        <p className="text-xs sm:text-sm text-amber-100 leading-relaxed">
          <span className="font-bold text-amber-300">
            PRE-ARB LIQUIDITY CASCADE VETO ({card.ticker}.JK):
          </span>{" "}
          Although all 4 agents agree directionally (
          <span className="font-mono text-cyan-300">
            &Phi;(x) = {card.sheaf_phi.toFixed(4)} &le; {card.cohomology_threshold.toFixed(2)}
          </span>
          ), they converge on a bearish liquidity vacuum. Pillar 2 Rough Path signature detects critical bid-queue depletion near the{" "}
          <span className="font-mono font-semibold text-rose-300">
            -7% IDX Auto Rejection Bawah ({formatRp(card.arb_floor_rp)})
          </span>{" "}
          floor with tail hazard{" "}
          <span className="font-mono font-bold text-rose-300">
            h_ARB = {(card.h_arb * 100).toFixed(1)}% &gt; 65.0%
          </span>
          . Execution Unifier blocks entry (
          <span className="font-mono font-bold text-rose-300">0 Lots</span>) to prevent locking capital in an unexitable ARB offer queue.
        </p>
      );
    }

    return (
      <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
        <span className="font-bold text-amber-300">
          INSUFFICIENT WDRO NET EDGE ({card.ticker}.JK):
        </span>{" "}
        Worst-case distributionally robust return under ambiguity radius{" "}
        <span className="font-mono text-cyan-300">&varepsilon;(&Phi;) = {(card.epsilon_phi * 100).toFixed(2)}%</span>{" "}
        does not clear the mandatory 3&times; IDX round-trip fee hurdle ({card.min_required_edge_pct.toFixed(2)}%). WDRO allocates 0 Lots.
      </p>
    );
  };

  return (
    <section
      className={`rounded-xl border p-4 sm:p-5 shadow-2xl transition-all ${
        isBuy
          ? "bg-gradient-to-r from-emerald-950/50 via-slate-900/95 to-slate-900/95 border-emerald-500/40"
          : isCohomologyBlocked
          ? "bg-gradient-to-r from-rose-950/55 via-slate-900/95 to-slate-900/95 border-rose-500/50"
          : "bg-gradient-to-r from-amber-950/50 via-slate-900/95 to-slate-900/95 border-amber-500/50"
      }`}
      data-testid="unified-decision-summary-banner"
    >
      {/* Top Row: Executive Synthesis + Copy Manual HITL Order Ticket Button */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800/90">
        <div className="flex items-start gap-3.5">
          <div
            className={`p-2.5 rounded-xl border shrink-0 mt-0.5 ${
              isBuy
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                : isCohomologyBlocked
                ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
                : "bg-amber-500/15 border-amber-500/40 text-amber-300"
            }`}
          >
            {isBuy ? (
              <ShieldCheck className="w-6 h-6" />
            ) : isCohomologyBlocked ? (
              <AlertOctagon className="w-6 h-6" />
            ) : (
              <ShieldAlert className="w-6 h-6" />
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-mono uppercase tracking-widest px-2 py-0.5 rounded bg-slate-950/90 text-slate-300 border border-slate-700/80 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-cyan-400" />
                EXECUTIVE DECISION SYNTHESIS
              </span>
              <span
                className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded border ${
                  isBuy
                    ? "bg-emerald-950/90 border-emerald-500/60 text-emerald-300"
                    : "bg-rose-950/90 border-rose-500/60 text-rose-300"
                }`}
              >
                {isBuy ? `APPROVED: ${card.approved_lots} LOTS (${card.approved_shares.toLocaleString("id-ID")} SHS)` : `VETOED: ${card.action} (0 LOTS)`}
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                Merkle Receipt: <code className="text-emerald-400">{card.receipt_sha256.slice(0, 12)}&hellip;</code>
              </span>
            </div>

            {renderExecutiveSynthesis()}
          </div>
        </div>

        {/* Interactive Copy Manual HITL Order Ticket Button */}
        <div className="shrink-0 flex sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end justify-between gap-2">
          <button
            type="button"
            onClick={handleCopyOrderTicket}
            data-testid="copy-hitl-ticket-button"
            className={`px-3.5 py-2.5 rounded-lg font-mono text-xs font-semibold border transition flex items-center justify-center gap-2 shadow-md ${
              copied
                ? "bg-emerald-600 border-emerald-400 text-white"
                : isBuy
                ? "bg-emerald-950/90 hover:bg-emerald-900/90 border-emerald-500/60 text-emerald-200"
                : "bg-slate-800/90 hover:bg-slate-700/90 border-slate-600 text-slate-200"
            }`}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-white" />
                <span>COPIED HITL TICKET!</span>
              </>
            ) : (
              <>
                <ClipboardCopy className="w-4 h-4 text-cyan-400" />
                <span>COPY MANUAL HITL TICKET</span>
              </>
            )}
          </button>
          <span className="text-[10px] font-mono text-slate-400 text-right">
            Read-Only Manual Execution &bull; Zero Auto-Order
          </span>
        </div>
      </div>

      {/* Bottom Row: 5-Pillar Consensus Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-3.5">
        {/* Pillar 1: Sinkhorn OT */}
        <div className="bg-slate-950/80 border border-slate-800/90 rounded-lg px-3 py-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
            <span className="flex items-center gap-1 uppercase font-semibold text-cyan-400">
              <Layers className="w-3 h-3" /> P1: Sinkhorn OT
            </span>
            <span>&kappa;={bdmKappa >= 0 ? `+${bdmKappa.toFixed(2)}` : bdmKappa.toFixed(2)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xs font-bold text-slate-100">
              {card.stalks.BDM.mu_5d >= 0 ? "Inst Accumulation" : "Bandar Distribution"}
            </span>
            <span
              className={`text-xs font-mono font-bold ${
                card.stalks.BDM.mu_5d >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              &mu;={card.stalks.BDM.mu_5d >= 0 ? `+${card.stalks.BDM.mu_5d.toFixed(2)}` : card.stalks.BDM.mu_5d.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Pillar 2: Rough Path LOB */}
        <div className="bg-slate-950/80 border border-slate-800/90 rounded-lg px-3 py-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
            <span className="flex items-center gap-1 uppercase font-semibold text-cyan-400">
              <Activity className="w-3 h-3" /> P2: Rough LOB
            </span>
            <span>L&eacute;vy={levyArea >= 0 ? `+${levyArea.toFixed(2)}` : levyArea.toFixed(2)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xs font-bold text-slate-100">
              {spoofingDetected ? "Spoofing Alert" : card.h_arb > 0.65 ? "ARB Queue Depleted" : "Bid Queue Resilient"}
            </span>
            <span
              className={`text-xs font-mono font-bold ${
                card.h_arb > 0.65 || spoofingDetected ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              h_ARB={(card.h_arb * 100).toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Pillar 3: Cellular Sheaf Cohomology */}
        <div className="bg-slate-950/80 border border-slate-800/90 rounded-lg px-3 py-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
            <span className="flex items-center gap-1 uppercase font-semibold text-cyan-400">
              <GitMerge className="w-3 h-3" /> P3: Sheaf H^1
            </span>
            <span>Max: {card.primary_fault_edge}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xs font-bold text-slate-100">
              {card.cohomology_veto ? "Cohomology Veto" : "Global Section OK"}
            </span>
            <span
              className={`text-xs font-mono font-bold ${
                card.cohomology_veto ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              &Phi;={card.sheaf_phi.toFixed(4)}
            </span>
          </div>
        </div>

        {/* Pillar 4: WDRO Portfolio Sizing */}
        <div className="bg-slate-950/80 border border-slate-800/90 rounded-lg px-3 py-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
            <span className="flex items-center gap-1 uppercase font-semibold text-cyan-400">
              <Scale className="w-3 h-3" /> P4: WDRO Sizing
            </span>
            <span>&varepsilon;(&Phi;)={(card.epsilon_phi * 100).toFixed(2)}%</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xs font-bold text-slate-100">
              {card.approved_lots > 0 ? `${card.approved_lots} Lots Approved` : "0 Lots (Blocked)"}
            </span>
            <span
              className={`text-xs font-mono font-bold ${
                card.approved_lots > 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {formatMillionRp(card.notional_exposure_rp)}
            </span>
          </div>
        </div>

        {/* Pillar 5: OU Optimal Stopping */}
        <div className="bg-slate-950/80 border border-slate-800/90 rounded-lg px-3 py-2 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
            <span className="flex items-center gap-1 uppercase font-semibold text-cyan-400">
              <Compass className="w-3 h-3" /> P5: OU Stopping
            </span>
            <span>E[&tau;*]={card.expected_holding_days.toFixed(1)}d</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xs font-bold text-slate-100">
              TP {formatRp(card.take_profit_rp)}
            </span>
            <span className="text-xs font-mono font-bold text-amber-300">
              SL {formatRp(card.stop_loss_pre_arb_rp)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
