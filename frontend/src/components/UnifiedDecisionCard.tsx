"use client";

import React from "react";
import { UnifiedDecisionCard as DecisionCardType } from "@/types/swrt";
import {
  AlertOctagon,
  ArrowUpRight,
  Calendar,
  Clock,
  Gauge,
  Lock,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";

interface Props {
  card: DecisionCardType;
}

function formatRp(val: number): string {
  return `Rp${val.toLocaleString("id-ID")}`;
}

function getIdxTickSize(priceRp: number): { tickRp: number; tierLabel: string; araPct: number } {
  if (priceRp < 200) {
    return { tickRp: 1, tierLabel: "< Rp200 (Fraksi Rp1)", araPct: 35 };
  }
  if (priceRp < 500) {
    return { tickRp: 2, tierLabel: "Rp200–Rp499 (Fraksi Rp2)", araPct: 25 };
  }
  if (priceRp < 2000) {
    return { tickRp: 5, tierLabel: "Rp500–Rp1,999 (Fraksi Rp5)", araPct: 25 };
  }
  if (priceRp < 5000) {
    return { tickRp: 10, tierLabel: "Rp2,000–Rp4,999 (Fraksi Rp10)", araPct: 25 };
  }
  return { tickRp: 25, tierLabel: "\u2265 Rp5,000 (Fraksi Rp25)", araPct: 20 };
}

export default function UnifiedDecisionCard({ card }: Props) {
  // Rule 4: Mandatory Merkle Audit Gate on UI Component
  const hasValidAuditGate =
    typeof card.receipt_sha256 === "string" &&
    /^[a-f0-9]{64}$/i.test(card.receipt_sha256) &&
    typeof card.parquet_uri === "string" &&
    card.parquet_uri.endsWith(".parquet");

  if (!hasValidAuditGate) {
    return (
      <div className="bg-rose-950/80 border-2 border-rose-500 rounded-xl p-6 text-rose-200">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <AlertOctagon className="w-5 h-5" />
          MANDATORY MERKLE AUDIT GATE BLOCKED RENDER
        </h3>
        <p className="text-sm mt-2">
          Trade decision rejected: missing cryptographic <code>receipt_sha256</code> or{" "}
          <code>parquet_uri</code> from <code>merkle_audit_mcp</code>.
        </p>
      </div>
    );
  }

  const isBuy = card.action === "BUY" && card.approved_lots > 0;
  const tickMeta = getIdxTickSize(card.entry_limit_rp);

  // Risk/Reward & Fee Coverage calculations
  const roundTripFeePct = 0.4; // 0.15% Buy + 0.25% Sell
  const epsilonPct = card.epsilon_phi * 100;
  const netEdgeAfterFeeAndAmbiguityPct = card.gross_tp_edge_pct - roundTripFeePct - epsilonPct;
  const downsideRiskFromEntryPct = Math.max(
    0.01,
    ((card.entry_limit_rp - card.stop_loss_pre_arb_rp) / Math.max(1, card.entry_limit_rp)) * 100
  );
  const netRewardToRiskRatio =
    (card.gross_tp_edge_pct - roundTripFeePct) / Math.max(0.1, downsideRiskFromEntryPct);
  const clearsHurdle = card.gross_tp_edge_pct >= card.min_required_edge_pct;

  // IDX Regulatory Price Ladder positions (normalized between ARB Floor and ARA Ceiling)
  const ladderMin = Math.min(card.arb_floor_rp, card.stop_loss_pre_arb_rp);
  const ladderMax = Math.max(card.ara_ceiling_rp, card.take_profit_rp);
  const ladderSpan = Math.max(1, ladderMax - ladderMin);
  const pctInLadder = (price: number) =>
    Math.min(100, Math.max(0, ((price - ladderMin) / ladderSpan) * 100));

  // Build SVG Trajectory Cone coordinates
  const cone = card.trajectory_cone || [];
  const allPrices = cone.flatMap((p) => [
    p.mean_rp,
    p.upper_2sigma_rp,
    p.lower_2sigma_rp,
    card.take_profit_rp,
    card.stop_loss_pre_arb_rp,
    card.arb_floor_rp,
  ]);
  const minP = Math.min(...allPrices) * 0.992;
  const maxP = Math.max(...allPrices) * 1.008;
  const svgW = 580;
  const svgH = 215;
  const padX = 52;
  const padRight = 22;
  const padY = 18;

  const xForDay = (day: number) =>
    padX + (day / Math.max(1, cone.length - 1)) * (svgW - padX - padRight);
  const yForPrice = (price: number) =>
    svgH - padY - ((price - minP) / Math.max(1, maxP - minP)) * (svgH - 2 * padY);

  const upper2Path = cone.map((pt) => `${xForDay(pt.day)},${yForPrice(pt.upper_2sigma_rp)}`);
  const lower2Path = [...cone]
    .reverse()
    .map((pt) => `${xForDay(pt.day)},${yForPrice(pt.lower_2sigma_rp)}`);
  const polygon2Sigma = [...upper2Path, ...lower2Path].join(" ");

  const upper1Path = cone.map((pt) => `${xForDay(pt.day)},${yForPrice(pt.upper_1sigma_rp)}`);
  const lower1Path = [...cone]
    .reverse()
    .map((pt) => `${xForDay(pt.day)},${yForPrice(pt.lower_1sigma_rp)}`);
  const polygon1Sigma = [...upper1Path, ...lower1Path].join(" ");

  const meanPolyline = cone
    .map((pt) => `${xForDay(pt.day)},${yForPrice(pt.mean_rp)}`)
    .join(" ");

  const yTP = yForPrice(card.take_profit_rp);
  const yEntry = yForPrice(card.entry_limit_rp);
  const ySL = yForPrice(card.stop_loss_pre_arb_rp);
  const yARB = yForPrice(card.arb_floor_rp);

  const gridPrices = [
    minP + (maxP - minP) * 0.2,
    minP + (maxP - minP) * 0.5,
    minP + (maxP - minP) * 0.8,
  ];

  const quantileDays = cone.filter((pt) => pt.day % 2 === 0);

  return (
    <div
      className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-xl"
      data-testid="unified-decision-card"
    >
      {/* Header & Action Verdict */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-extrabold text-white tracking-tight">
              1 UNIFIED DECISION CARD — {card.ticker}.JK
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              {card.regime}
            </span>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-800/60">
              {tickMeta.tierLabel}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Read-Only HITL Execution Plan &bull; Kep-00157/BEI/10-2026 Symmetrical -7% ARB / +{tickMeta.araPct}% ARA Compliant
          </p>
        </div>

        <div
          className={`px-4 py-2 rounded-lg font-mono text-sm font-extrabold tracking-wider border flex items-center gap-2 ${
            isBuy
              ? "bg-emerald-950/90 border-emerald-500 text-emerald-300 shadow-lg shadow-emerald-950/50"
              : "bg-rose-950/90 border-rose-500 text-rose-300 shadow-lg shadow-rose-950/50"
          }`}
          data-testid="decision-action-badge"
        >
          {isBuy ? (
            <>
              <ArrowUpRight className="w-4 h-4 text-emerald-400" />
              <span>ACTION: BUY ({card.approved_lots} LOTS)</span>
            </>
          ) : (
            <>
              <Lock className="w-4 h-4 text-rose-400" />
              <span>{card.action} (0 LOTS)</span>
            </>
          )}
        </div>
      </div>

      {/* Veto Alert Banner when Blocked */}
      {card.veto_reason && (
        <div
          className="bg-rose-950/60 border border-rose-600/60 rounded-lg p-3 text-xs text-rose-200 flex items-start gap-2.5"
          data-testid="veto-reason-banner"
        >
          <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold uppercase tracking-wide text-rose-300">
              Mathematical Circuit Breaker Triggered:{" "}
            </span>
            <span>{card.veto_reason}</span>
          </div>
        </div>
      )}

      {/* Primary Execution Grid: Lots, Entry, Take-Profit, Pre-ARB Stop-Loss */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
          <div className="text-[11px] font-mono uppercase text-slate-400">WDRO Approved Size</div>
          <div
            className={`text-xl font-extrabold font-mono mt-1 ${
              isBuy ? "text-emerald-400" : "text-rose-400"
            }`}
            data-testid="approved-lots-value"
          >
            {card.approved_lots.toLocaleString()} Lots
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
            {card.approved_shares.toLocaleString()} shs ({card.optimal_weight_pct.toFixed(1)}% cap)
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
          <div className="text-[11px] font-mono uppercase text-slate-400">Entry Limit Tick</div>
          <div
            className="text-xl font-extrabold font-mono text-cyan-300 mt-1"
            data-testid="entry-tick-value"
          >
            {formatRp(card.entry_limit_rp)}
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
            Prev Close: {formatRp(card.prev_close_rp)} (Tick Rp{tickMeta.tickRp})
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
          <div className="text-[11px] font-mono uppercase text-slate-400">OU Take-Profit Tick</div>
          <div
            className="text-xl font-extrabold font-mono text-emerald-300 mt-1"
            data-testid="tp-tick-value"
          >
            {formatRp(card.take_profit_rp)}
          </div>
          <div className="text-[11px] font-mono text-emerald-400/90 mt-0.5">
            +{card.gross_tp_edge_pct.toFixed(2)}% (Min &ge; {card.min_required_edge_pct.toFixed(2)}%)
          </div>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
          <div className="text-[11px] font-mono uppercase text-slate-400">Pre-ARB Stop-Loss</div>
          <div
            className="text-xl font-extrabold font-mono text-amber-300 mt-1"
            data-testid="sl-tick-value"
          >
            {formatRp(card.stop_loss_pre_arb_rp)}
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
            {card.pre_arb_drawdown_from_prev_close_pct.toFixed(2)}% vs Prev (-7% ARB:{" "}
            {formatRp(card.arb_floor_rp)})
          </div>
        </div>
      </div>

      {/* IDX Regulatory Price Ladder & Pre-ARB Circuit Breaker Bar */}
      <div className="bg-slate-950/75 border border-slate-800/90 rounded-lg p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-slate-200 flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
            IDX REGULATORY PRICE LADDER &amp; PRE-ARB CIRCUIT BREAKER CORRIDOR
          </span>
          <span className="font-mono text-[11px] text-slate-400">
            SL Cushion above -7% ARB:{" "}
            <strong className="text-amber-300">
              +{formatRp(Math.max(0, card.stop_loss_pre_arb_rp - card.arb_floor_rp))} (
              {Math.round(
                Math.max(0, card.stop_loss_pre_arb_rp - card.arb_floor_rp) / tickMeta.tickRp
              )}{" "}
              ticks)
            </strong>
          </span>
        </div>

        {/* Visual Horizontal Corridor Bar */}
        <div className="relative h-3.5 rounded-full bg-slate-900 border border-slate-800 overflow-hidden">
          {/* Danger Zone between ARB and Pre-ARB Floor */}
          <div
            className="absolute inset-y-0 left-0 bg-rose-500/35 border-r border-rose-500"
            style={{ width: `${pctInLadder(card.pre_arb_floor_rp)}%` }}
            title="ARB Liquidity Freeze Hazard Zone"
          />
          {/* Active Profit Zone between Entry and TP */}
          <div
            className="absolute inset-y-0 bg-emerald-500/30 border-x border-emerald-400/70"
            style={{
              left: `${pctInLadder(Math.min(card.entry_limit_rp, card.take_profit_rp))}%`,
              width: `${Math.max(
                1.5,
                pctInLadder(card.take_profit_rp) - pctInLadder(card.entry_limit_rp)
              )}%`,
            }}
          />
          {/* Markers */}
          <div
            className="absolute inset-y-0 w-1 bg-amber-400"
            style={{ left: `${pctInLadder(card.stop_loss_pre_arb_rp)}%` }}
            title={`Pre-ARB SL: ${formatRp(card.stop_loss_pre_arb_rp)}`}
          />
          <div
            className="absolute inset-y-0 w-1 bg-cyan-300"
            style={{ left: `${pctInLadder(card.entry_limit_rp)}%` }}
            title={`Entry: ${formatRp(card.entry_limit_rp)}`}
          />
          <div
            className="absolute inset-y-0 w-1 bg-emerald-400"
            style={{ left: `${pctInLadder(card.take_profit_rp)}%` }}
            title={`TP: ${formatRp(card.take_profit_rp)}`}
          />
        </div>

        {/* 6 Tick-Aligned Price Nodes */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 pt-0.5 text-[10px] font-mono">
          <div className="bg-rose-950/40 border border-rose-800/50 rounded px-2 py-1">
            <div className="text-rose-400">ARB (-7.0%)</div>
            <div className="font-bold text-rose-200">{formatRp(card.arb_floor_rp)}</div>
          </div>
          <div className="bg-amber-950/35 border border-amber-800/50 rounded px-2 py-1">
            <div className="text-amber-400">Pre-ARB (-5.2%)</div>
            <div className="font-bold text-amber-200">{formatRp(card.pre_arb_floor_rp)}</div>
          </div>
          <div className="bg-amber-950/50 border border-amber-600/60 rounded px-2 py-1">
            <div className="text-amber-300">Pre-ARB SL</div>
            <div className="font-bold text-white">{formatRp(card.stop_loss_pre_arb_rp)}</div>
          </div>
          <div className="bg-slate-900/90 border border-slate-700/80 rounded px-2 py-1">
            <div className="text-slate-400">Prev Close</div>
            <div className="font-bold text-slate-200">{formatRp(card.prev_close_rp)}</div>
          </div>
          <div className="bg-cyan-950/40 border border-cyan-700/60 rounded px-2 py-1">
            <div className="text-cyan-300">Entry Limit</div>
            <div className="font-bold text-white">{formatRp(card.entry_limit_rp)}</div>
          </div>
          <div className="bg-emerald-950/40 border border-emerald-700/60 rounded px-2 py-1">
            <div className="text-emerald-300">OU Target / ARA</div>
            <div className="font-bold text-emerald-200">
              {formatRp(card.take_profit_rp)} / {formatRp(card.ara_ceiling_rp)}
            </div>
          </div>
        </div>
      </div>

      {/* Holding Horizon, Time-Stop & Risk/Reward Fee Audit Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg px-3 py-2.5 flex items-center gap-2.5">
          <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="text-xs">
            <div className="text-slate-400 text-[11px]">Expected Holding E[&tau;*]</div>
            <div className="font-mono font-bold text-slate-100">
              {card.expected_holding_days.toFixed(1)} Trading Days
            </div>
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg px-3 py-2.5 flex items-center gap-2.5">
          <Calendar className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="text-xs">
            <div className="text-slate-400 text-[11px]">Hard Time-Stop (T_max)</div>
            <div className="font-mono font-bold text-slate-100">
              {card.time_stop_date} ({card.hard_time_stop_days}d)
            </div>
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg px-3 py-2.5 flex items-center gap-2.5">
          <Scale className="w-4 h-4 text-purple-400 shrink-0" />
          <div className="text-xs">
            <div className="text-slate-400 text-[11px]">Net R:R &amp; Fee Hurdle</div>
            <div className="font-mono font-bold text-slate-100">
              {netRewardToRiskRatio.toFixed(2)}x{" "}
              <span className={clearsHurdle ? "text-emerald-400" : "text-rose-400"}>
                (Net {netEdgeAfterFeeAndAmbiguityPct >= 0 ? "+" : ""}
                {netEdgeAfterFeeAndAmbiguityPct.toFixed(2)}%)
              </span>
            </div>
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg px-3 py-2.5 flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="text-xs">
            <div className="text-slate-400 text-[11px]">Notional Exposure</div>
            <div className="font-mono font-bold text-slate-100">
              {formatRp(card.notional_exposure_rp)}
            </div>
          </div>
        </div>
      </div>

      {/* 10-Day Forward Ornstein-Uhlenbeck Trajectory Cone SVG */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-slate-200 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-cyan-400" />
            10-DAY FORWARD ORNSTEIN-UHLENBECK TRAJECTORY CONE (IDX TICK-ALIGNED)
          </span>
          <span className="font-mono text-[11px] text-slate-400">
            1&sigma; / 2&sigma; Fan &bull; &theta;*={card.pillar_diagnostics?.ou_stopping?.ou_theta} &bull;{" "}
            &sigma;_d={card.pillar_diagnostics?.ou_stopping?.ou_sigma_daily}
          </span>
        </div>

        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-48 overflow-visible"
          data-testid="trajectory-cone-svg"
        >
          <defs>
            <linearGradient id="cone1SigmaBuy" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.18" />
            </linearGradient>
            <linearGradient id="cone2SigmaBuy" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.06" />
            </linearGradient>
            <linearGradient id="cone1SigmaVeto" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.16" />
            </linearGradient>
            <linearGradient id="cone2SigmaVeto" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Subtle horizontal price gridlines */}
          {gridPrices.map((gp, i) => {
            const gy = yForPrice(gp);
            return (
              <g key={i}>
                <line
                  x1={padX}
                  y1={gy}
                  x2={svgW - padRight}
                  y2={gy}
                  stroke="#1e293b"
                  strokeWidth="1"
                />
                <text
                  x={padX - 6}
                  y={gy + 3}
                  fill="#64748b"
                  fontSize="8.5"
                  fontFamily="monospace"
                  textAnchor="end"
                >
                  {Math.round(gp).toLocaleString("id-ID")}
                </text>
              </g>
            );
          })}

          {/* 2-sigma and 1-sigma shaded fans */}
          <polygon
            points={polygon2Sigma}
            fill={isBuy ? "url(#cone2SigmaBuy)" : "url(#cone2SigmaVeto)"}
          />
          <polygon
            points={polygon1Sigma}
            fill={isBuy ? "url(#cone1SigmaBuy)" : "url(#cone1SigmaVeto)"}
          />

          {/* Take Profit line */}
          <line
            x1={padX}
            y1={yTP}
            x2={svgW - padRight}
            y2={yTP}
            stroke="#10b981"
            strokeDasharray="4 4"
            strokeWidth="1.2"
          />
          <text
            x={svgW - padRight - 2}
            y={yTP - 4}
            fill="#10b981"
            fontSize="9"
            fontFamily="monospace"
            textAnchor="end"
          >
            OU TP {formatRp(card.take_profit_rp)}
          </text>

          {/* Entry Limit line */}
          <line
            x1={padX}
            y1={yEntry}
            x2={svgW - padRight}
            y2={yEntry}
            stroke="#38bdf8"
            strokeDasharray="2 3"
            strokeWidth="1"
          />
          <text
            x={padX + 4}
            y={yEntry - 4}
            fill="#38bdf8"
            fontSize="8.5"
            fontFamily="monospace"
          >
            Entry {formatRp(card.entry_limit_rp)}
          </text>

          {/* Pre-ARB Stop-Loss line */}
          <line
            x1={padX}
            y1={ySL}
            x2={svgW - padRight}
            y2={ySL}
            stroke="#f59e0b"
            strokeDasharray="4 4"
            strokeWidth="1.2"
          />
          <text
            x={svgW - padRight - 2}
            y={ySL - 4}
            fill="#f59e0b"
            fontSize="9"
            fontFamily="monospace"
            textAnchor="end"
          >
            Pre-ARB SL {formatRp(card.stop_loss_pre_arb_rp)}
          </text>

          {/* -7% ARB Floor reference line */}
          <line
            x1={padX}
            y1={yARB}
            x2={svgW - padRight}
            y2={yARB}
            stroke="#f43f5e"
            strokeDasharray="2 2"
            strokeWidth="1"
            opacity="0.7"
          />

          {/* Mean OU Trajectory */}
          <polyline
            fill="none"
            stroke={isBuy ? "#34d399" : "#fb7185"}
            strokeWidth="2.4"
            points={meanPolyline}
          />

          {/* Day nodes */}
          {cone.map((pt) => (
            <g key={pt.day}>
              <circle
                cx={xForDay(pt.day)}
                cy={yForPrice(pt.mean_rp)}
                r="2.8"
                fill={isBuy ? "#10b981" : "#f43f5e"}
              />
              {pt.day % 2 === 0 && (
                <text
                  x={xForDay(pt.day)}
                  y={svgH - 3}
                  fill="#94a3b8"
                  fontSize="9"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  D+{pt.day}
                </text>
              )}
            </g>
          ))}
        </svg>

        {/* Compact Day-by-Day Trajectory Quantile Strip */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 pt-1 border-t border-slate-800/80">
          {quantileDays.map((pt) => (
            <div
              key={pt.day}
              className="bg-slate-900/75 border border-slate-800/90 rounded px-2 py-1 text-[10px] font-mono"
            >
              <div className="flex items-center justify-between text-slate-400">
                <span>D+{pt.day}</span>
                <span className={isBuy ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                  {formatRp(pt.mean_rp)}
                </span>
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5 truncate">
                1&sigma;: {pt.lower_1sigma_rp.toLocaleString("id-ID")}–
                {pt.upper_1sigma_rp.toLocaleString("id-ID")}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
