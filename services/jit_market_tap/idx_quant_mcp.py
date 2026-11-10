"""
JIT Market Tap & IDX Structural Quant MCP Server (`idx-structural-quant`).

Provides:
1. Optional live read-only public quote probe for `.JK` tickers via `httpx`
2. High-precision deterministic replay feeds for the 3 canonical IDX market regimes:
   - `COHERENT_ACCUMULATION` (e.g., `BBCA` — Institutional Accumulation + Thick Bid Cushion + Positive LK)
   - `BANDAR_BULL_TRAP` (e.g., `BREN` — Gorengan Pucuk: Euphoric NLP +0.90 vs Bandar Distribution -0.80 + LOB Spoofing)
   - `ARB_LIQUIDITY_CASCADE` (e.g., `GOTO` — -7% ARB Queue Depletion + UMA Alert + Bid Vacuum)
"""

from __future__ import annotations

from datetime import datetime, timezone
import math
from typing import Any

from fastmcp import FastMCP
import httpx
import numpy as np

from services.jit_market_tap.cdp_websocket_tap import (
    fetch_live_idx_yahoo_snapshot,
    probe_local_cdp_websocket,
)
from services.swrt_math_kernel_mcp.idx_rules import round_to_idx_tick

mcp = FastMCP("idx-structural-quant")

SUPPORTED_REGIMES = (
    "COHERENT_ACCUMULATION",
    "BANDAR_BULL_TRAP",
    "ARB_LIQUIDITY_CASCADE",
    "LIVE_MARKET_FEED",
)


def _generate_running_trades_1000(
    regime: str,
    prev_close_rp: int,
    last_price_rp: int,
    seed: int = 42,
) -> dict[str, Any]:
    """
    Generate 1,000 deterministic Running Trade ticks and intraday L2 microstructure
    trajectories (`micro_prices`, `ofi_series`, `cancel_rates`) tailored to the regime.
    """
    rng = np.random.default_rng(seed)
    n_ticks = 1000
    t = np.linspace(0.0, 1.0, n_ticks)

    if regime == "COHERENT_ACCUMULATION":
        # Steady institutional VWAP accumulation from prev_close_rp to last_price_rp
        base_curve = prev_close_rp + (last_price_rp - prev_close_rp) * (0.75 * t + 0.25 * np.sin(np.pi * t / 2.0))
        micro_prices = (base_curve + rng.normal(0.0, prev_close_rp * 0.0005, size=n_ticks)).tolist()
        # Consistent positive Order Flow Imbalance (institutional bid absorption + HAKA sweeps)
        ofi_series = (45.0 + 30.0 * np.sin(2.0 * np.pi * t) + rng.normal(0.0, 8.0, size=n_ticks)).tolist()
        # Low, calm order cancellation intensity (no phantom bid wall pulling)
        cancel_rates = np.clip(0.06 + 0.02 * np.cos(2.0 * np.pi * t) + rng.normal(0.0, 0.005, size=n_ticks), 0.01, 0.20).tolist()

    elif regime == "BANDAR_BULL_TRAP":
        # Early retail markup spike followed by stalling / heavy supply absorption at the top
        markup_wave = np.sin(np.pi * np.clip(t * 1.35, 0.0, 1.0))
        base_curve = prev_close_rp + (last_price_rp - prev_close_rp) * (0.35 + 0.65 * markup_wave - 0.45 * (t**2))
        micro_prices = (base_curve + rng.normal(0.0, prev_close_rp * 0.0012, size=n_ticks)).tolist()
        # Spoofing cycle: phantom bid walls inflate OFI first (cos phase), immediately followed
        # by massive order cancellation waves (sin phase) -> positive Lévy Area A_{OFI, Cancel} > 0
        freq = 6.0 * np.pi * t
        ofi_series = (95.0 * np.cos(freq) - 18.0 * t + rng.normal(0.0, 6.0, size=n_ticks)).tolist()
        cancel_rates = np.clip(0.48 + 0.42 * np.sin(freq) + 0.20 * t + rng.normal(0.0, 0.02, size=n_ticks), 0.05, 0.99).tolist()

    else:
        # ARB_LIQUIDITY_CASCADE: Rapid bid collapse toward the -7% ARB limit
        collapse_curve = prev_close_rp - (prev_close_rp - last_price_rp) * (1.0 - np.exp(-3.8 * t))
        micro_prices = (collapse_curve + rng.normal(0.0, max(0.5, prev_close_rp * 0.0015), size=n_ticks)).tolist()
        # Heavy negative OFI (HAKI panic selling hitting bids)
        ofi_series = (-120.0 - 85.0 * t + rng.normal(0.0, 12.0, size=n_ticks)).tolist()
        # High bid withdrawal / cancellation panic as price nears ARB
        cancel_rates = np.clip(0.62 + 0.30 * t + rng.normal(0.0, 0.03, size=n_ticks), 0.20, 0.99).tolist()

    # Sample summary of running trade tape (keep compact tape summary + full 1,000 arrays)
    sample_trades = []
    for idx in range(0, n_ticks, 50):
        px = round_to_idx_tick(micro_prices[idx], mode="nearest")
        sample_trades.append(
            {
                "tick_id": idx + 1,
                "price_rp": px,
                "lots": int(max(10, abs(ofi_series[idx]) * 4.5)),
                "side": "BUY_HAKA" if ofi_series[idx] >= 0 else "SELL_HAKI",
            }
        )

    return {
        "tick_count": n_ticks,
        "micro_prices": [round(float(x), 3) for x in micro_prices],
        "ofi_series": [round(float(x), 3) for x in ofi_series],
        "cancel_rates": [round(float(x), 4) for x in cancel_rates],
        "tape_sample": sample_trades,
    }


@mcp.tool()
def fetch_jit_market_bundle(
    ticker: str = "BBCA",
    regime: str = "COHERENT_ACCUMULATION",
    try_live_probe: bool = False,
) -> dict[str, Any]:
    """
    Fetch or synthesize a complete IDX market microstructure bundle for `ticker` and `regime`:
    - L2 Orderbook (10 bid/ask levels)
    - 1,000 Running Trade ticks & intraday rough-path channels
    - Intraday Broker Summary (Top buyers & sellers with institutional/retail classifications)
    - IDXNet Keterbukaan Informasi & UMA filings
    - Macro & Laporan Keuangan (LK) fundamental solvency metrics
    """
    clean_ticker = ticker.upper().strip()
    clean_regime = regime.upper().strip()
    if clean_regime not in SUPPORTED_REGIMES:
        raise ValueError(f"Unsupported regime '{regime}'. Expected one of {SUPPORTED_REGIMES}.")

    if clean_regime == "LIVE_MARKET_FEED":
        live_bundle = fetch_live_idx_yahoo_snapshot(ticker=clean_ticker)
        cdp_status = probe_local_cdp_websocket(ticker=clean_ticker)
        live_bundle["regime"] = "LIVE_MARKET_FEED"
        live_bundle["cdp_websocket_probe"] = cdp_status
        if isinstance(live_bundle.get("live_probe"), dict):
            live_bundle["live_probe"]["cdp_connected"] = cdp_status.get("cdp_connected", False)
            live_bundle["live_probe"]["cdp_mode"] = cdp_status.get("mode", "READ_ONLY_JIT")
        return live_bundle

    # Optional lightweight live quote probe (read-only Yahoo Finance public chart endpoint)
    live_probe_meta: dict[str, Any] = {"live_attempted": try_live_probe, "live_status": "OFFLINE_REPLAY"}
    if try_live_probe:
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{clean_ticker}.JK?interval=1d&range=5d"
            with httpx.Client(timeout=2.5, headers={"User-Agent": "Mozilla/5.0"}) as client:
                resp = client.get(url)
                if resp.status_code == 200:
                    live_probe_meta["live_status"] = "HTTP_200_OK"
        except Exception as exc:
            live_probe_meta["live_status"] = f"FALLBACK_TO_DETERMINISTIC ({type(exc).__name__})"

    if clean_regime == "COHERENT_ACCUMULATION":
        prev_close_rp = 9800 if clean_ticker == "BBCA" else 4200
        last_price_rp = round_to_idx_tick(prev_close_rp * 1.0128, mode="nearest")
        adv_lots = 185_000

        bid_levels_lots = [18500.0, 24200.0, 31000.0, 28500.0, 26000.0, 22000.0, 19500.0, 17000.0, 15500.0, 14000.0]
        ask_levels_lots = [6200.0, 7400.0, 8100.0, 9200.0, 9800.0, 10500.0, 11200.0, 12000.0, 11500.0, 11000.0]

        brokers_buy = [
            {"broker": "ZP", "lots": 68500, "avg_price": last_price_rp, "category": "INST_FOREIGN"},
            {"broker": "YU", "lots": 54200, "avg_price": last_price_rp, "category": "INST_FOREIGN"},
            {"broker": "AK", "lots": 46800, "avg_price": last_price_rp - 25, "category": "INST_FOREIGN"},
            {"broker": "BK", "lots": 39100, "avg_price": last_price_rp - 25, "category": "INST_FOREIGN"},
            {"broker": "CC", "lots": 24500, "avg_price": last_price_rp, "category": "INST_DOMESTIC"},
            {"broker": "YP", "lots": 8200, "avg_price": last_price_rp, "category": "RETAIL"},
        ]
        brokers_sell = [
            {"broker": "YP", "lots": 74500, "avg_price": last_price_rp - 25, "category": "RETAIL"},
            {"broker": "PD", "lots": 62800, "avg_price": last_price_rp - 25, "category": "RETAIL"},
            {"broker": "XC", "lots": 48200, "avg_price": last_price_rp, "category": "RETAIL"},
            {"broker": "XL", "lots": 36900, "avg_price": last_price_rp, "category": "RETAIL"},
            {"broker": "KK", "lots": 18900, "avg_price": last_price_rp, "category": "RETAIL"},
        ]

        idxnet_filings = [
            {
                "filing_id": f"IDXNET-{clean_ticker}-20261028-01",
                "type": "KETERBUKAAN_INFORMASI",
                "title": f"{clean_ticker} Melaporkan Pertumbuhan Laba Bersih +16.4% YoY & Pembagian Dividen Interim Tunai",
                "sentiment_score": 0.82,
                "materiality_weight": 0.90,
                "uma_flag": False,
                "insider_net_buy_lots": 45000,
            }
        ]

        macro_lk = {
            "usd_idr": 15620.0,
            "usd_idr_5d_change_pct": -0.45,
            "bi_rate_pct": 5.75,
            "commodity_tailwind_score": 0.68,
            "roe_pct": 21.8,
            "debt_to_equity": 0.22,
            "altman_z_score": 4.15,
            "ocf_to_net_income": 1.28,
            "pe_zscore_5y": -0.85,
        }

    elif clean_regime == "BANDAR_BULL_TRAP":
        # Gorengan Pucuk / Bandar Bull Trap:
        # Public NLP catalyst is euphoric (+0.90), while Bandar BDM is heavily distributing (-0.80)
        # into retail FOMO and LOB shows spoofing!
        prev_close_rp = 6800 if clean_ticker == "BREN" else 2500
        last_price_rp = round_to_idx_tick(prev_close_rp * 1.036, mode="nearest")
        adv_lots = 95_000

        # Thin real bid support below top-of-book, heavy hidden/layered ask supply
        bid_levels_lots = [9500.0, 3200.0, 2100.0, 1800.0, 1500.0, 1200.0, 1100.0, 900.0, 800.0, 750.0]
        ask_levels_lots = [18500.0, 26000.0, 31500.0, 29000.0, 27500.0, 24000.0, 21000.0, 19500.0, 18000.0, 16500.0]

        brokers_buy = [
            {"broker": "YP", "lots": 92000, "avg_price": last_price_rp, "category": "RETAIL"},
            {"broker": "PD", "lots": 78500, "avg_price": last_price_rp, "category": "RETAIL"},
            {"broker": "XC", "lots": 64000, "avg_price": last_price_rp, "category": "RETAIL"},
            {"broker": "XL", "lots": 51200, "avg_price": last_price_rp - 25, "category": "RETAIL"},
            {"broker": "MG", "lots": 28000, "avg_price": last_price_rp, "category": "RETAIL"},
        ]
        brokers_sell = [
            {"broker": "ZP", "lots": 112000, "avg_price": last_price_rp, "category": "INST_FOREIGN"},
            {"broker": "BK", "lots": 86500, "avg_price": last_price_rp, "category": "INST_FOREIGN"},
            {"broker": "YU", "lots": 69200, "avg_price": last_price_rp - 25, "category": "INST_FOREIGN"},
            {"broker": "AK", "lots": 46000, "avg_price": last_price_rp - 25, "category": "INST_FOREIGN"},
        ]

        idxnet_filings = [
            {
                "filing_id": f"IDXNET-{clean_ticker}-20261028-02",
                "type": "PUBLIC_EXPOSE_CATALYST",
                "title": f"{clean_ticker} Umumkan Rencana Ekspansi Strategis & Target Pendapatan Rekor Baru",
                "sentiment_score": 0.94,
                "materiality_weight": 0.96,
                "uma_flag": False,
                "insider_net_buy_lots": 12000,
            }
        ]

        macro_lk = {
            "usd_idr": 15890.0,
            "usd_idr_5d_change_pct": 0.35,
            "bi_rate_pct": 6.00,
            "commodity_tailwind_score": 0.20,
            "roe_pct": 7.5,
            "debt_to_equity": 2.40,
            "altman_z_score": 1.65,
            "ocf_to_net_income": 0.45,
            "pe_zscore_5y": 2.65,
        }

    else:
        # ARB_LIQUIDITY_CASCADE (-7% Auto Rejection Bawah Queue Depletion)
        prev_close_rp = 200 if clean_ticker == "GOTO" else 400
        # Price sits at -6.5% from prev_close_rp, 1 tick above the -7% ARB limit!
        last_price_rp = round_to_idx_tick(prev_close_rp * 0.935, mode="ceil")
        adv_lots = 320_000

        # Bid liquidity nearly wiped out; huge ask queue stacked at ARB/near-ARB
        bid_levels_lots = [450.0, 180.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
        ask_levels_lots = [185000.0, 142000.0, 98000.0, 76000.0, 64000.0, 52000.0, 48000.0, 41000.0, 35000.0, 29000.0]

        brokers_buy = [
            {"broker": "YP", "lots": 42000, "avg_price": last_price_rp, "category": "RETAIL"},
            {"broker": "PD", "lots": 38000, "avg_price": last_price_rp, "category": "RETAIL"},
            {"broker": "XC", "lots": 29000, "avg_price": last_price_rp + 1, "category": "RETAIL"},
        ]
        brokers_sell = [
            {"broker": "YU", "lots": 58000, "avg_price": last_price_rp, "category": "INST_FOREIGN"},
            {"broker": "ZP", "lots": 34000, "avg_price": last_price_rp, "category": "INST_FOREIGN"},
            {"broker": "CC", "lots": 17000, "avg_price": last_price_rp + 1, "category": "INST_DOMESTIC"},
        ]

        idxnet_filings = [
            {
                "filing_id": f"IDXNET-{clean_ticker}-20261028-03",
                "type": "UMA_WARNING",
                "title": f"Pengumuman Unusual Market Activity (UMA) & Penurunan Tajam Harga Saham {clean_ticker}",
                "sentiment_score": -0.88,
                "materiality_weight": 0.95,
                "uma_flag": True,
                "insider_net_buy_lots": -65000,
            }
        ]

        macro_lk = {
            "usd_idr": 16180.0,
            "usd_idr_5d_change_pct": 1.45,
            "bi_rate_pct": 6.25,
            "commodity_tailwind_score": -0.55,
            "roe_pct": -14.2,
            "debt_to_equity": 1.95,
            "altman_z_score": 0.92,
            "ocf_to_net_income": -0.80,
            "pe_zscore_5y": 1.90,
        }

    rt_data = _generate_running_trades_1000(
        regime=clean_regime,
        prev_close_rp=prev_close_rp,
        last_price_rp=last_price_rp,
    )

    return {
        "ticker": clean_ticker,
        "regime": clean_regime,
        "captured_at_utc": datetime.now(timezone.utc).isoformat(),
        "prev_close_rp": prev_close_rp,
        "last_price_rp": last_price_rp,
        "adv_lots": adv_lots,
        "live_probe": live_probe_meta,
        "orderbook": {
            "bid_levels_lots": bid_levels_lots,
            "ask_levels_lots": ask_levels_lots,
            "micro_prices": rt_data["micro_prices"],
            "ofi_series": rt_data["ofi_series"],
            "cancel_rates": rt_data["cancel_rates"],
        },
        "running_trades": rt_data["tape_sample"],
        "running_trades_count": rt_data["tick_count"],
        "broker_summary": {
            "brokers_buy": brokers_buy,
            "brokers_sell": brokers_sell,
        },
        "idxnet_filings": idxnet_filings,
        "macro_lk": macro_lk,
    }


if __name__ == "__main__":
    mcp.run()
