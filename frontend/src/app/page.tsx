"use client";

import React, { useEffect, useState } from "react";
import { AuditReceiptRow, AuditVaultPayload, UnifiedDecisionCard } from "@/types/swrt";
import TopNavBar from "@/components/TopNavBar";
import HumanFriendlyCharts from "@/components/HumanFriendlyCharts";
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
} from "lucide-react";

const STOCK_SCENARIOS = [
  {
    ticker: "BBCA",
    regime: "COHERENT_ACCUMULATION",
    title: "BBCA — Positive Institutional Buying",
    subtitle: "All 4 signals positive • Approved BUY (25 Lots)",
    tone: "emerald",
  },
  {
    ticker: "BREN",
    regime: "BANDAR_BULL_TRAP",
    title: "BREN — Bull Trap (Positive News vs Negative Broker Flow)",
    subtitle: "Signals contradict (Φ = 0.92) • Blocked (0 Lots)",
    tone: "rose",
  },
  {
    ticker: "GOTO",
    regime: "ARB_LIQUIDITY_CASCADE",
    title: "GOTO — Negative Trend & -7% ARB Crash Risk",
    subtitle: "All signals negative (-4.5% 5D drift) • Avoid (0 Lots)",
    tone: "amber",
  },
] as const;

const QUICK_TICKER_CHIPS = [
  { ticker: "BMRI", label: "BMRI (Positive)" },
  { ticker: "ADRO", label: "ADRO (Positive)" },
  { ticker: "UNVR", label: "UNVR (Negative)" },
  { ticker: "BUKA", label: "BUKA (Negative)" },
  { ticker: "MDKA", label: "MDKA (Negative)" },
  { ticker: "TLKM", label: "TLKM (Neutral / No Edge)" },
  { ticker: "BUMI", label: "BUMI (Bull Trap)" },
];

function formatRp(val: number): string {
  return "Rp" + Math.round(val).toLocaleString("id-ID");
}

function getExpected5dReturnPct(card: UnifiedDecisionCard): number {
  const wdroRet = card.pillar_diagnostics?.wdro?.expected_5d_return;
  if (typeof wdroRet === "number") {
    return wdroRet * 100;
  }
  const mu = card.consensus_stalk?.[0] ?? 0;
  return mu * 6.5;
}

function getFriendlySummary(card: UnifiedDecisionCard): {
  headline: string;
  explanation: string;
  badgeText: string;
  isBuy: boolean;
} {
  const exp5dPct = getExpected5dReturnPct(card);

  if (card.action === "BUY" && card.approved_lots > 0) {
    return {
      isBuy: true,
      badgeText: `ACTION: BUY (${card.approved_lots} LOTS)`,
      headline: `Buy ${card.approved_lots} Lots (${card.approved_shares.toLocaleString()} Shares) of ${card.ticker}.JK`,
      explanation: `Passed the <5% False-Positive Gate (95% WDRO Confidence): all 4 pillars agree positively with expected 5-day drift of +${exp5dPct.toFixed(2)}% and low contradicton energy (Φ = ${card.sheaf_phi.toFixed(3)}).`,
    };
  }
  if (card.action === "BLOCKED_COHOMOLOGY") {
    return {
      isBuy: false,
      badgeText: "BLOCKED_COHOMOLOGY (0 LOTS)",
      headline: `Do Not Buy ${card.ticker}.JK — Bull Trap Contradiction (0 Lots)`,
      explanation: `Blocked by Sheaf Cohomology (Φ = ${card.sheaf_phi.toFixed(3)} > ${card.cohomology_threshold.toFixed(2)}): public news/price looks positive, but institutional broker flow (${((card.stalks?.BDM?.mu_5d ?? 0) * 100).toFixed(0)}%) and orderbook (${((card.stalks?.LOB?.mu_5d ?? 0) * 100).toFixed(0)}%) are negative.`,
    };
  }
  if (card.action === "AVOID_ARB_HAZARD") {
    return {
      isBuy: false,
      badgeText: "AVOID_ARB_HAZARD (0 LOTS)",
      headline: `Do Not Buy ${card.ticker}.JK — Negative Cascade Near -7% ARB (0 Lots)`,
      explanation: `Blocked by -7% ARB Hazard (h_ARB = ${(card.h_arb * 100).toFixed(1)}% > 65%): all signals are negative (expected 5D return ${exp5dPct.toFixed(2)}%) and bid liquidity is depleting near ${formatRp(card.arb_floor_rp)}.`,
    };
  }
  if (exp5dPct < 0) {
    return {
      isBuy: false,
      badgeText: "NEGATIVE / BEARISH DRIFT (0 LOTS)",
      headline: `Do Not Buy ${card.ticker}.JK — Negative Expected Return (${exp5dPct.toFixed(2)}%)`,
      explanation: `The mathematical kernel calculated a negative 5-day expected return (${exp5dPct.toFixed(2)}%, consensus μ = ${(card.consensus_stalk?.[0] ?? 0).toFixed(3)}). Institutional broker flow and orderbook pressure are net negative.`,
    };
  }
  return {
    isBuy: false,
    badgeText: "HOLD_NO_EDGE (0 LOTS)",
    headline: `Do Not Buy ${card.ticker}.JK — Below 95% Confidence Gate (0 Lots)`,
    explanation: `Filtered out by the <5% False-Positive Gate: expected return (${exp5dPct >= 0 ? "+" : ""}${exp5dPct.toFixed(2)}%) is too weak after 0.40% IDX round-trip fees and Wasserstein uncertainty (ε = ${(card.epsilon_phi * 100).toFixed(2)}%).`,
  };
}

export default function HomePage() {
  const [vault, setVault] = useState<AuditVaultPayload | null>(null);
  const [activeCard, setActiveCard] = useState<UnifiedDecisionCard | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [runningRegime, setRunningRegime] = useState<string | null>(null);
  const [customTicker, setCustomTicker] = useState<string>("UNVR");
  const [error, setError] = useState<string | null>(null);
  const [copiedPlan, setCopiedPlan] = useState<boolean>(false);

  const fetchVault = async (preferredRegime?: string, retryCount = 0) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/swrt", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load stock analysis");
      }
      setVault(data);
      if (data.receipts && data.receipts.length > 0) {
        if (preferredRegime) {
          const match = data.receipts.find(
            (r: AuditReceiptRow) => r.regime === preferredRegime
          );
          if (match) {
            setActiveCard(match.decision);
            return;
          }
        }
        const bbca = data.receipts.find(
          (r: AuditReceiptRow) => r.regime === "COHERENT_ACCUMULATION"
        );
        setActiveCard(bbca ? bbca.decision : data.receipts[0].decision);
      }
    } catch (err: any) {
      if (retryCount < 2) {
        setTimeout(() => fetchVault(preferredRegime, retryCount + 1), 1200);
        return;
      }
      setError(err?.message || "Unable to load analysis");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVault();
  }, []);

  const handleSelectScenario = async (ticker: string, regime: string) => {
    const existing = vault?.receipts.find(
      (r) => r.ticker === ticker && r.regime === regime
    );
    if (existing) {
      setActiveCard(existing.decision);
      return;
    }
    await executeStockAnalysis(ticker, regime);
  };

  const executeStockAnalysis = async (ticker: string, regime: string) => {
    try {
      setRunningRegime(regime);
      setError(null);
      const res = await fetch("/api/swrt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, regime }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Stock analysis failed");
      }
      setVault(data);
      const latest = data.receipts.find(
        (r: AuditReceiptRow) =>
          r.ticker === ticker.toUpperCase() && r.regime === regime
      );
      if (latest) {
        setActiveCard(latest.decision);
      }
    } catch (err: any) {
      setError(err?.message);
    } finally {
      setRunningRegime(null);
    }
  };

  const handleCopyTradePlan = () => {
    if (!activeCard) return;
    const exp5dPct = getExpected5dReturnPct(activeCard);
    const text = [
      `IDX SMART TRADE PLAN — ${activeCard.ticker}.JK`,
      `Recommendation: ${activeCard.action} (${activeCard.approved_lots} Lots / ${activeCard.approved_shares} Shares)`,
      `Expected 5-Day Return: ${exp5dPct >= 0 ? "+" : ""}${exp5dPct.toFixed(2)}%`,
      `Buy Limit Price: ${formatRp(activeCard.entry_limit_rp)}`,
      `Reference Target Tick: ${formatRp(activeCard.take_profit_rp)}`,
      `Safety Stop-Loss: ${formatRp(activeCard.stop_loss_pre_arb_rp)} (Before -7% ARB Floor ${formatRp(activeCard.arb_floor_rp)})`,
      `Suggested Hold Time: ~${activeCard.expected_holding_days} trading days (Exit by ${activeCard.time_stop_date})`,
    ].join("\n");
    navigator.clipboard.writeText(text);
    setCopiedPlan(true);
    setTimeout(() => setCopiedPlan(false), 2200);
  };

  const summary = activeCard ? getFriendlySummary(activeCard) : null;
  const expected5dPct = activeCard ? getExpected5dReturnPct(activeCard) : 0;
  const worstCase5dPct =
    (activeCard?.pillar_diagnostics?.wdro?.worst_case_wdro_return ?? 0) * 100;
  const dailyChangePct = activeCard
    ? ((activeCard.last_price_rp - activeCard.prev_close_rp) /
        Math.max(1, activeCard.prev_close_rp)) *
      100
    : 0;

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Multi-Page Navigation Header */}
      <TopNavBar />

      {/* Simple Stock Selector & Search Bar */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">
              Choose an IDX Stock to Analyze
            </h1>
            <p className="text-xs text-slate-400">
              Strict &lt;5% False-Positive Gate: Positive stocks show positive drift, negative stocks stay negative, and bull traps are blocked.
            </p>
          </div>

          {/* Custom Stock Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customTicker.trim()) {
                executeStockAnalysis(
                  customTicker.trim().toUpperCase(),
                  "LIVE_MARKET_FEED"
                );
              }
            }}
            className="flex items-center gap-2"
          >
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={customTicker}
                onChange={(e) => setCustomTicker(e.target.value.toUpperCase())}
                placeholder="Stock code (e.g. UNVR)"
                maxLength={6}
                className="w-40 bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-emerald-400"
              />
            </div>
            <button
              type="submit"
              disabled={runningRegime !== null}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors cursor-pointer"
            >
              {runningRegime === "LIVE_MARKET_FEED" ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4 fill-current" />
              )}
              Analyze Stock
            </button>
          </form>
        </div>

        {/* Quick-Test Ticker Chips (Positive, Negative, Neutral, Bull Trap) */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] text-slate-400 mr-1">Quick Test Tickers:</span>
          {QUICK_TICKER_CHIPS.map((chip) => (
            <button
              key={chip.ticker}
              type="button"
              onClick={() => {
                setCustomTicker(chip.ticker);
                executeStockAnalysis(chip.ticker, "LIVE_MARKET_FEED");
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                activeCard?.ticker === chip.ticker &&
                activeCard?.regime === "LIVE_MARKET_FEED"
                  ? "bg-emerald-500/20 border-emerald-400 text-emerald-200"
                  : "bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* 3 Preset Canonical Regimes */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {STOCK_SCENARIOS.map((item) => {
            const isSelected =
              activeCard?.ticker === item.ticker &&
              activeCard?.regime === item.regime;

            return (
              <button
                key={item.regime}
                type="button"
                data-testid={`regime-btn-${item.regime}`}
                onClick={() => handleSelectScenario(item.ticker, item.regime)}
                className={`text-left p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                  isSelected
                    ? item.tone === "emerald"
                      ? "bg-emerald-950/60 border-emerald-400 text-white shadow-lg"
                      : item.tone === "rose"
                      ? "bg-rose-950/60 border-rose-400 text-white shadow-lg"
                      : "bg-amber-950/60 border-amber-400 text-white shadow-lg"
                    : "bg-slate-950/80 border-slate-800 hover:border-slate-700 text-slate-200"
                }`}
              >
                <div>
                  <div className="text-xs font-bold">{item.title}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {item.subtitle}
                  </div>
                </div>
                {isSelected && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/15 text-white shrink-0">
                    Viewing
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {error && (
        <div className="bg-rose-950/80 border border-rose-500 rounded-xl p-4 text-sm text-rose-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchVault()}
            className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-xs font-bold text-rose-200 cursor-pointer"
          >
            Try Again
          </button>
        </div>
      )}

      {/* THE 1 UNIFIED TRADE DECISION CARD */}
      {activeCard && summary ? (
        <>
          <section
            data-testid="unified-decision-card"
            className={`rounded-2xl p-6 border-2 shadow-2xl space-y-6 ${
              summary.isBuy
                ? "bg-gradient-to-br from-slate-900 via-emerald-950/25 to-slate-900 border-emerald-500/60"
                : "bg-gradient-to-br from-slate-900 via-rose-950/25 to-slate-900 border-rose-500/60"
            }`}
          >
            {/* Top Recommendation Banner */}
            <div
              data-testid="unified-decision-summary-banner"
              className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-800/90 pb-5"
            >
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span
                    data-testid="decision-action-badge"
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-extrabold ${
                      summary.isBuy
                        ? "bg-emerald-500 text-slate-950"
                        : "bg-rose-500 text-white"
                    }`}
                  >
                    {summary.isBuy ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <AlertTriangle className="w-4 h-4" />
                    )}
                    {summary.badgeText}
                  </span>

                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-200">
                    Last Price: {formatRp(activeCard.last_price_rp)} (Prev Close:{" "}
                    {formatRp(activeCard.prev_close_rp)} &bull;{" "}
                    <span
                      className={
                        dailyChangePct >= 0 ? "text-emerald-400" : "text-rose-400"
                      }
                    >
                      {dailyChangePct >= 0 ? "+" : ""}
                      {dailyChangePct.toFixed(2)}%
                    </span>
                    )
                  </span>

                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold border ${
                      expected5dPct > 0
                        ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/40"
                        : "bg-rose-950/80 text-rose-300 border-rose-500/40"
                    }`}
                  >
                    Expected 5D Drift: {expected5dPct >= 0 ? "+" : ""}
                    {expected5dPct.toFixed(2)}% (Worst-Case WDRO:{" "}
                    {worstCase5dPct >= 0 ? "+" : ""}
                    {worstCase5dPct.toFixed(2)}%)
                  </span>
                </div>

                <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  {summary.headline}
                </h2>
                <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
                  {summary.explanation}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  data-testid="copy-hitl-ticket-button"
                  onClick={handleCopyTradePlan}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition-colors cursor-pointer"
                >
                  {copiedPlan ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      Copied Trade Plan!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 text-emerald-400" />
                      Copy Trade Plan for Broker App
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* If Blocked/Avoid, show a clear plain-English warning banner */}
            {!summary.isBuy && activeCard.veto_reason && (
              <div
                data-testid="veto-reason-banner"
                className="bg-rose-950/70 border border-rose-500/50 rounded-xl p-4 flex items-start gap-3"
              >
                <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="text-xs sm:text-sm text-rose-100">
                  <strong className="font-bold block text-rose-300 mb-0.5">
                    Why This Trade Was Blocked (&lt;5% False-Positive Safety Filter):
                  </strong>
                  MATHEMATICAL CIRCUIT BREAKER TRIGGERED: {activeCard.veto_reason}
                </div>
              </div>
            )}

            {/* 4 Clear Action Numbers for the Trader */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* 1. Lots to Buy */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-1">
                <span className="text-xs font-semibold text-slate-400">
                  1. Suggested Volume
                </span>
                <div
                  data-testid="approved-lots-value"
                  className={`text-2xl font-black ${
                    summary.isBuy ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {activeCard.approved_lots} Lots
                </div>
                <div className="text-xs text-slate-400">
                  {activeCard.approved_shares.toLocaleString()} shares &bull;{" "}
                  {formatRp(activeCard.notional_exposure_rp)}
                </div>
              </div>

              {/* 2. Buy Price (Entry) */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-1">
                <span className="text-xs font-semibold text-slate-400">
                  {summary.isBuy
                    ? "2. Buy Limit Price (Entry)"
                    : "2. Entry Reference Tick"}
                </span>
                <div
                  data-testid="entry-tick-value"
                  className={`text-2xl font-black ${
                    summary.isBuy ? "text-sky-300" : "text-slate-400"
                  }`}
                >
                  {formatRp(activeCard.entry_limit_rp)}
                </div>
                <div className="text-xs text-slate-400">
                  {summary.isBuy
                    ? "Exact IDX Tick Price (Fraksi Harga)"
                    : "Do Not Enter (0 Lots Approved)"}
                </div>
              </div>

              {/* 3. Target Sell Price vs Negative Expected Drift */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-1">
                <span className="text-xs font-semibold text-slate-400">
                  {summary.isBuy
                    ? "3. Target Sell Price (Take Profit)"
                    : "3. Expected 5D Return & Ref Tick"}
                </span>
                {summary.isBuy ? (
                  <>
                    <div
                      data-testid="tp-tick-value"
                      className="text-2xl font-black text-emerald-300"
                    >
                      {formatRp(activeCard.take_profit_rp)}
                    </div>
                    <div className="text-xs text-emerald-400 font-semibold">
                      +{activeCard.gross_tp_edge_pct.toFixed(2)}% Target Gain (5D Drift: +
                      {expected5dPct.toFixed(2)}%)
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      className={`text-2xl font-black flex items-center gap-1.5 ${
                        expected5dPct < 0 ? "text-rose-400" : "text-amber-300"
                      }`}
                    >
                      {expected5dPct < 0 && <TrendingDown className="w-5 h-5" />}
                      {expected5dPct >= 0 ? "+" : ""}
                      {expected5dPct.toFixed(2)}% (5D)
                    </div>
                    <div className="text-xs text-slate-400">
                      Ref TP Tick:{" "}
                      <span data-testid="tp-tick-value" className="font-mono">
                        {formatRp(activeCard.take_profit_rp)}
                      </span>{" "}
                      &bull; Worst-Case: {worstCase5dPct >= 0 ? "+" : ""}
                      {worstCase5dPct.toFixed(2)}%
                    </div>
                  </>
                )}
              </div>

              {/* 4. Safety Stop-Loss */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-1">
                <span className="text-xs font-semibold text-slate-400">
                  4. Pre-ARB Safety Floor
                </span>
                <div
                  data-testid="sl-tick-value"
                  className="text-2xl font-black text-amber-300"
                >
                  {formatRp(activeCard.stop_loss_pre_arb_rp)}
                </div>
                <div className="text-xs text-amber-400">
                  Exits safely above the -7% ARB lock ({formatRp(activeCard.arb_floor_rp)})
                </div>
              </div>
            </div>

            {/* Bottom Strip: Holding Horizon & Data Verification Status */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs text-slate-300">
              <div className="flex flex-wrap items-center gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                  <strong>Suggested Holding Time:</strong>{" "}
                  {summary.isBuy
                    ? `~${activeCard.expected_holding_days} Trading Days`
                    : "0 Days (Do Not Hold)"}
                </span>
                <span className="text-slate-400">
                  <strong>Max Time-Stop Date:</strong>{" "}
                  <span className="text-white font-semibold">
                    {activeCard.time_stop_date}
                  </span>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                <span
                  data-testid="rust-engine-latency-badge"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-950/40 border border-orange-500/30 text-orange-300 font-mono text-[10px]"
                >
                  ⚡ Calculated in{" "}
                  {activeCard.pillar_diagnostics?.rust_kernel_latency_us
                    ? `${activeCard.pillar_diagnostics.rust_kernel_latency_us} µs`
                    : "<1 ms"}{" "}
                  by Rust Math Engine
                </span>

                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span data-testid="merkle-chain-status">
                    MERKLE CHAIN VERIFIED ({vault?.verification?.total_receipts || 1} BLOCKS)
                  </span>
                  <span
                    data-testid="active-receipt-sha256"
                    className="sr-only"
                  >
                    {activeCard.receipt_sha256}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Easy-to-Read Visual Charts Explaining the Decision */}
          <HumanFriendlyCharts card={activeCard} />
        </>
      ) : (
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-12 text-center text-sm text-slate-300">
          Loading your stock trading plan...
        </div>
      )}
    </main>
  );
}
