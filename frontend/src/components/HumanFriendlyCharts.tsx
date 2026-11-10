"use client";

import React from "react";
import { UnifiedDecisionCard } from "@/types/swrt";
import PentagonTensegrityRadar from "@/components/PentagonTensegrityRadar";
import {
  BarChart2,
  Building2,
  FileText,
  Layers,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

function formatRp(val: number): string {
  return "Rp" + Math.round(val).toLocaleString("id-ID");
}

export default function HumanFriendlyCharts({
  card,
}: {
  card: UnifiedDecisionCard;
}) {
  const bdm = card.stalks?.BDM;
  const lob = card.stalks?.LOB;
  const nlp = card.stalks?.NLP;
  const mac = card.stalks?.MAC;

  const bdmDiag = (bdm?.diagnostics || {}) as Record<string, any>;
  const lobDiag = (lob?.diagnostics || {}) as Record<string, any>;
  const nlpDiag = (nlp?.diagnostics || {}) as Record<string, any>;
  const macDiag = (mac?.diagnostics || {}) as Record<string, any>;

  const consensusMu = card.consensus_stalk?.[0] ?? 0;
  const isBuy = card.action === "BUY" && card.approved_lots > 0;
  const isContradiction =
    card.cohomology_veto || card.sheaf_phi > card.cohomology_threshold;

  // Exact computed values from the mathematical kernel (zero fabricated defaults)
  const bdmMu = bdm?.mu_5d ?? 0;
  const lobMu = lob?.mu_5d ?? 0;
  const nlpMu = nlp?.mu_5d ?? 0;
  const macMu = mac?.mu_5d ?? 0;

  const retailToInstPct =
    typeof bdmDiag.retail_to_inst_flow === "number"
      ? (bdmDiag.retail_to_inst_flow * 100).toFixed(1)
      : null;
  const instToRetailPct =
    typeof bdmDiag.inst_to_retail_flow === "number"
      ? (bdmDiag.inst_to_retail_flow * 100).toFixed(1)
      : null;
  const netInstPressurePct =
    typeof bdmDiag.net_inst_pressure === "number"
      ? (bdmDiag.net_inst_pressure * 100).toFixed(1)
      : null;

  const bookImbalancePct =
    typeof lobDiag.book_imbalance === "number"
      ? (lobDiag.book_imbalance * 100).toFixed(1)
      : ((lob?.liquidity_score ?? 0) * 100).toFixed(1);

  const signals = [
    {
      id: "BDM",
      title: "1. Big Money / Bandar Flow (Sinkhorn OT)",
      subtitle: "Institutional vs Retail Broker Coupling",
      icon: Users,
      score: bdmMu,
      verdict:
        bdmMu > 0.25
          ? "Net Institutional Buying (Positive)"
          : bdmMu < -0.15
          ? "Net Institutional Selling / Distribution (Negative)"
          : "Mixed / Neutral Broker Flow",
      explanation:
        retailToInstPct !== null && instToRetailPct !== null
          ? `Retail→Inst flow: ${retailToInstPct}% • Inst→Retail dump: ${instToRetailPct}% • Net Inst Pressure: ${
              Number(netInstPressurePct) >= 0 ? "+" : ""
            }${netInstPressurePct}%.`
          : bdm?.summary_rationale || `Computed BDM drift μ = ${bdmMu.toFixed(3)}.`,
    },
    {
      id: "LOB",
      title: "2. Orderbook & Intraday Path (Rough Signature)",
      subtitle: "Bid/Ask Queue Imbalance & -7% ARB Hazard",
      icon: Layers,
      score: lobMu,
      verdict: lobDiag.spoofing_detected
        ? "Orderbook Spoofing Detected (Negative)"
        : card.h_arb > 0.65
        ? "Severe Selling Near -7% ARB Limit (Negative)"
        : lobMu < -0.1
        ? "Ask Supply Overwhelms Bid Support (Negative)"
        : lobMu > 0.2
        ? "Positive Bid Queue Support"
        : "Neutral Orderbook Depth",
      explanation: `Orderbook Bid/Ask Imbalance: ${
        Number(bookImbalancePct) >= 0 ? "+" : ""
      }${bookImbalancePct}% • -7% ARB Depletion Hazard (h_ARB): ${(
        card.h_arb * 100
      ).toFixed(1)}%.`,
    },
    {
      id: "NLP",
      title: "3. Official IDXNet Filings & Insider Flow",
      subtitle: "Disclosures, UMA Alerts & Net Insider Lots",
      icon: FileText,
      score: nlpMu,
      verdict: nlpDiag.uma_flag
        ? "IDX Unusual Market Activity (UMA) Warning (Negative)"
        : nlpMu > 0.2
        ? "Positive Disclosure / Momentum"
        : nlpMu < -0.15
        ? "Negative Disclosure / Price Momentum"
        : "Neutral Disclosure State",
      explanation:
        nlpDiag.latest_headline ||
        nlp?.summary_rationale ||
        `Computed NLP drift μ = ${nlpMu.toFixed(3)}.`,
    },
    {
      id: "MAC",
      title: "4. Financial Health & Valuation (LK + Macro)",
      subtitle: "ROE, Debt-to-Equity, Altman Z & Valuation Z-Score",
      icon: Building2,
      score: macMu,
      verdict:
        macMu > 0.2
          ? "Healthy Fundamentals & Valuation (Positive)"
          : macMu < -0.15
          ? "Weak Solvency or Overvalued (Negative)"
          : "Neutral Valuation",
      explanation: `ROE: ${macDiag.roe_pct ?? "N/A"}% • Debt/Equity: ${
        macDiag.debt_to_equity ?? "N/A"
      }x • Altman Z: ${macDiag.altman_z_score ?? "N/A"} • PE Z-Score: ${
        macDiag.pe_zscore_5y ?? "N/A"
      }.`,
    },
  ];

  // SVG 10-Day Price Forecast Chart Geometry
  const cone = card.trajectory_cone || [];
  const coneStartRp = cone.length > 0 ? cone[0].mean_rp : card.last_price_rp;
  const coneEndRp =
    cone.length > 0 ? cone[cone.length - 1].mean_rp : card.last_price_rp;
  const projected10dPct =
    ((coneEndRp - coneStartRp) / Math.max(1, coneStartRp)) * 100;
  const isPositiveTrajectory = isBuy && projected10dPct >= 0;

  const allPrices = [
    card.arb_floor_rp,
    card.pre_arb_floor_rp,
    card.stop_loss_pre_arb_rp,
    card.entry_limit_rp,
    card.take_profit_rp,
    ...cone.flatMap((p) => [p.lower_2sigma_rp, p.upper_2sigma_rp, p.mean_rp]),
  ].filter((v) => typeof v === "number" && v > 0);

  const minP = Math.min(...allPrices) * 0.985;
  const maxP = Math.max(...allPrices) * 1.015;
  const width = 680;
  const height = 270;
  const padL = 68;
  const padR = 115;
  const padT = 22;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const xOf = (dayIdx: number) =>
    padL + (dayIdx / Math.max(1, cone.length - 1)) * plotW;
  const yOf = (price: number) =>
    padT + (1 - (price - minP) / Math.max(1, maxP - minP)) * plotH;

  const meanPoints = cone
    .map((pt, i) => `${xOf(i).toFixed(1)},${yOf(pt.mean_rp).toFixed(1)}`)
    .join(" ");

  const bandPolygon =
    cone.length > 1
      ? [
          ...cone.map(
            (pt, i) => `${xOf(i).toFixed(1)},${yOf(pt.upper_1sigma_rp).toFixed(1)}`
          ),
          ...[...cone]
            .reverse()
            .map(
              (pt, revIdx) =>
                `${xOf(cone.length - 1 - revIdx).toFixed(1)},${yOf(
                  pt.lower_1sigma_rp
                ).toFixed(1)}`
            ),
        ].join(" ")
      : "";

  return (
    <div className="space-y-6">
      {/* Row 1: 10-Day Expected Price Chart + 4 Signed Market Signals */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left 7 Cols: 10-Day Price Forecast & Safety Zones */}
        <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                {isPositiveTrajectory ? (
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                ) : (
                  <TrendingDown className="w-5 h-5 text-rose-400" />
                )}
                10-Day Ornstein-Uhlenbeck Price Path ({card.ticker}.JK)
              </h3>
              <p className="text-xs text-slate-400">
                {isPositiveTrajectory
                  ? "Positive upward mean-reverting trajectory toward target"
                  : "Negative / blocked trajectory — expected price drifts downward or lacks edge"}
              </p>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold self-start sm:self-center border ${
                projected10dPct > 0 && isBuy
                  ? "bg-emerald-950 text-emerald-300 border-emerald-500/40"
                  : projected10dPct < 0
                  ? "bg-rose-950 text-rose-300 border-rose-500/40"
                  : "bg-slate-800 text-slate-200 border-slate-700"
              }`}
            >
              10D Projected Path: {projected10dPct >= 0 ? "+" : ""}
              {projected10dPct.toFixed(2)}% ({formatRp(coneStartRp)} &rarr;{" "}
              {formatRp(coneEndRp)})
            </span>
          </div>

          {/* Clean SVG Chart */}
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-auto bg-slate-950/90 rounded-xl border border-slate-800/80"
            >
              {/* Shaded 1-Sigma Expected Range (Green if Positive BUY, Red if Negative/Blocked) */}
              {bandPolygon && (
                <polygon
                  points={bandPolygon}
                  fill={
                    isPositiveTrajectory
                      ? "rgba(16, 185, 129, 0.13)"
                      : "rgba(244, 63, 94, 0.14)"
                  }
                  stroke={
                    isPositiveTrajectory
                      ? "rgba(16, 185, 129, 0.28)"
                      : "rgba(244, 63, 94, 0.30)"
                  }
                  strokeWidth="1"
                />
              )}

              {/* Take-Profit Reference Line */}
              <line
                x1={padL}
                y1={yOf(card.take_profit_rp)}
                x2={width - padR}
                y2={yOf(card.take_profit_rp)}
                stroke="#10b981"
                strokeWidth="1.5"
                strokeDasharray="6 4"
              />
              <text
                x={width - padR + 6}
                y={yOf(card.take_profit_rp) + 4}
                fill="#34d399"
                fontSize="10"
                fontWeight="bold"
              >
                Ref TP {formatRp(card.take_profit_rp)}
              </text>

              {/* Entry / Start Reference Line */}
              <line
                x1={padL}
                y1={yOf(coneStartRp)}
                x2={width - padR}
                y2={yOf(coneStartRp)}
                stroke="#38bdf8"
                strokeWidth="1.5"
              />
              <text
                x={width - padR + 6}
                y={yOf(coneStartRp) + 4}
                fill="#7dd3fc"
                fontSize="10"
                fontWeight="bold"
              >
                Day 0 {formatRp(coneStartRp)}
              </text>

              {/* Pre-ARB Safety Stop-Loss Line */}
              <line
                x1={padL}
                y1={yOf(card.stop_loss_pre_arb_rp)}
                x2={width - padR}
                y2={yOf(card.stop_loss_pre_arb_rp)}
                stroke="#f59e0b"
                strokeWidth="1.8"
                strokeDasharray="4 3"
              />
              <text
                x={width - padR + 6}
                y={yOf(card.stop_loss_pre_arb_rp) + 4}
                fill="#fbbf24"
                fontSize="10"
                fontWeight="bold"
              >
                Pre-ARB {formatRp(card.stop_loss_pre_arb_rp)}
              </text>

              {/* IDX -7% ARB Floor Line */}
              <line
                x1={padL}
                y1={yOf(card.arb_floor_rp)}
                x2={width - padR}
                y2={yOf(card.arb_floor_rp)}
                stroke="#f43f5e"
                strokeWidth="1.5"
              />
              <text
                x={width - padR + 6}
                y={yOf(card.arb_floor_rp) + 4}
                fill="#fb7185"
                fontSize="10"
                fontWeight="bold"
              >
                -7% ARB {formatRp(card.arb_floor_rp)}
              </text>

              {/* Expected Mean Trajectory Curve (Green when Positive BUY, Red when Negative/Bearish) */}
              {meanPoints && (
                <polyline
                  fill="none"
                  stroke={isPositiveTrajectory ? "#34d399" : "#fb7185"}
                  strokeWidth="3"
                  points={meanPoints}
                />
              )}

              {/* Day points */}
              {cone.map((pt, i) => (
                <g key={pt.day}>
                  <circle
                    cx={xOf(i)}
                    cy={yOf(pt.mean_rp)}
                    r={3.5}
                    fill={isPositiveTrajectory ? "#10b981" : "#f43f5e"}
                    stroke="#0f172a"
                    strokeWidth="1.5"
                  />
                  {i % 2 === 0 && (
                    <text
                      x={xOf(i)}
                      y={height - 10}
                      fill="#94a3b8"
                      fontSize="10"
                      textAnchor="middle"
                    >
                      Day {pt.day}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>

          {/* Simple Legend in Plain Trader Terms */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
              <span className="text-slate-400 block text-[11px]">
                Day 10 Projected Mean
              </span>
              <strong
                className={`text-sm ${
                  projected10dPct >= 0 && isBuy
                    ? "text-emerald-300"
                    : projected10dPct < 0
                    ? "text-rose-400"
                    : "text-amber-300"
                }`}
              >
                {formatRp(coneEndRp)}
              </strong>
              <span
                className={`text-[10px] block font-semibold ${
                  projected10dPct >= 0 && isBuy
                    ? "text-emerald-400"
                    : "text-rose-400"
                }`}
              >
                {projected10dPct >= 0 ? "+" : ""}
                {projected10dPct.toFixed(2)}% vs Day 0
              </span>
            </div>
            <div className="bg-slate-950/80 border border-sky-500/30 rounded-xl p-2.5">
              <span className="text-slate-400 block text-[11px]">
                Day 0 Reference Price
              </span>
              <strong className="text-sky-300 text-sm">
                {formatRp(coneStartRp)}
              </strong>
              <span className="text-[10px] text-slate-400 block">
                Prev Close: {formatRp(card.prev_close_rp)}
              </span>
            </div>
            <div className="bg-slate-950/80 border border-amber-500/30 rounded-xl p-2.5">
              <span className="text-slate-400 block text-[11px]">
                Pre-ARB Safety Floor
              </span>
              <strong className="text-amber-300 text-sm">
                {formatRp(card.stop_loss_pre_arb_rp)}
              </strong>
              <span className="text-[10px] text-amber-400 block">
                {card.pre_arb_drawdown_from_prev_close_pct.toFixed(2)}% vs Prev Close
              </span>
            </div>
            <div className="bg-slate-950/80 border border-rose-500/30 rounded-xl p-2.5">
              <span className="text-slate-400 block text-[11px]">
                IDX -7% Auto-Reject
              </span>
              <strong className="text-rose-300 text-sm">
                {formatRp(card.arb_floor_rp)}
              </strong>
              <span className="text-[10px] text-rose-400 block">
                Daily ARB Floor Limit
              </span>
            </div>
          </div>
        </div>

        {/* Right 5 Cols: 4 Specialist Signals with Zero-Centered Bidirectional Bars [-100% .. 0% .. +100%] */}
        <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between space-y-4">
          <div className="space-y-2 border-b border-slate-800 pb-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-indigo-400" />
                4 Specialist Signal Vectors ([-100% to +100%])
              </h3>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                  isContradiction
                    ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                    : consensusMu < 0
                    ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                    : isBuy
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                    : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                }`}
              >
                {isContradiction
                  ? `Contradiction Alert (Φ = ${card.sheaf_phi.toFixed(3)})`
                  : consensusMu < 0
                  ? `Bearish Consensus (μ = ${consensusMu.toFixed(2)})`
                  : isBuy
                  ? `Bullish Consensus (μ = +${consensusMu.toFixed(2)})`
                  : `Neutral / Weak (μ = ${consensusMu >= 0 ? "+" : ""}${consensusMu.toFixed(2)})`}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Left of center (0%) is <strong>Negative / Selling Pressure (Red)</strong>; right of center is <strong>Positive / Buying Pressure (Green)</strong>. No averaging or hallucinated probabilities.
            </p>
          </div>

          {/* 4 Zero-Centered Bidirectional Signal Bars */}
          <div className="space-y-3">
            {signals.map((sig) => {
              const Icon = sig.icon;
              const clamped = Math.max(-1, Math.min(1, sig.score));
              const pct = Math.round(clamped * 100);
              const isPositive = pct > 5;
              const isNegative = pct < -5;
              const halfWidthPct = Math.min(50, Math.abs(pct) / 2);

              return (
                <div
                  key={sig.id}
                  className="bg-slate-950/85 border border-slate-800/90 rounded-xl p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isPositive
                            ? "text-emerald-400"
                            : isNegative
                            ? "text-rose-400"
                            : "text-amber-400"
                        }`}
                      />
                      <div>
                        <div className="text-xs font-bold text-white">
                          {sig.title}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {sig.subtitle}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`text-xs font-mono font-bold px-2 py-0.5 rounded-lg border ${
                        isPositive
                          ? "bg-emerald-950 text-emerald-300 border-emerald-500/30"
                          : isNegative
                          ? "bg-rose-950 text-rose-300 border-rose-500/30"
                          : "bg-slate-900 text-slate-300 border-slate-700"
                      }`}
                    >
                      {pct > 0 ? `+${pct}% (μ=+${clamped.toFixed(2)})` : `${pct}% (μ=${clamped.toFixed(2)})`}
                    </span>
                  </div>

                  {/* True Zero-Centered Bidirectional Bar: [-100% <-- 0% --> +100%] */}
                  <div className="relative w-full h-2.5 bg-slate-900 border border-slate-800 rounded-full overflow-hidden">
                    {/* Center 0% axis line */}
                    <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-500 z-10" />
                    {pct >= 0 ? (
                      <div
                        className="absolute top-0 bottom-0 bg-emerald-400 rounded-r-full"
                        style={{
                          left: "50%",
                          width: `${ Math.max(1, halfWidthPct)}%`,
                        }}
                      />
                    ) : (
                      <div
                        className="absolute top-0 bottom-0 bg-rose-500 rounded-l-full"
                        style={{
                          left: `${50 - Math.max(1, halfWidthPct)}%`,
                          width: `${Math.max(1, halfWidthPct)}%`,
                        }}
                      />
                    )}
                  </div>

                  <div
                    className={`text-xs font-semibold ${
                      isPositive
                        ? "text-emerald-300"
                        : isNegative
                        ? "text-rose-300"
                        : "text-slate-300"
                    }`}
                  >
                    {sig.verdict}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {sig.explanation}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Row 2: Visual 3D Signal Balance Map */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-white">
              Visual 3D Sheaf Cohomology &amp; Contradiction Map
            </h3>
            <p className="text-xs text-slate-400">
              Measures whether the 4 specialists agree or contradict each other ($\Phi(x)$). A <strong>Tall Red Spike</strong> ($\Phi(x) &gt; 0.70$) indicates a Bull Trap where public news is positive while institutional brokers are selling.
            </p>
          </div>
        </div>
        <PentagonTensegrityRadar card={card} />
      </div>
    </div>
  );
}
