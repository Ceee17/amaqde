"""
Agent 3 (`agent_nlp_catalyst.py`) — IDXNet Keterbukaan Informasi & UMA Parser.

Extracts the 4D Stalk Vector x_NLP = [mu_5d, theta_star, liquidity_score, h_arb]
from IDXNet corporate disclosures, Unusual Market Activity (UMA) flags, and
insider ownership change filings.
"""

from __future__ import annotations

from typing import Any
import numpy as np

from agents.schemas import StalkVector4D


def extract_nlp_stalk(raw_market_bundle: dict[str, Any]) -> StalkVector4D:
    """
    Parse IDXNet Keterbukaan Informasi and UMA filings into the 4D stalk vector x_NLP.
    """
    ticker = str(raw_market_bundle.get("ticker", "UNKNOWN")).upper()
    filings: list[dict[str, Any]] = raw_market_bundle.get("idxnet_filings", [])

    if not filings:
        return StalkVector4D(
            agent_id="NLP",
            ticker=ticker,
            mu_5d=0.0,
            theta_star=0.45,
            liquidity_score=0.10,
            h_arb=0.10,
            summary_rationale="No recent IDXNet Keterbukaan Informasi or UMA alerts.",
            diagnostics={"filing_count": 0},
        )

    weighted_sentiment = 0.0
    total_weight = 0.0
    uma_triggered = False
    net_insider_lots = 0
    titles: list[str] = []

    for f in filings:
        sent = float(f.get("sentiment_score", 0.0))
        mat = max(0.05, float(f.get("materiality_weight", 0.5)))
        weighted_sentiment += sent * mat
        total_weight += mat
        if bool(f.get("uma_flag", False)):
            uma_triggered = True
        net_insider_lots += int(f.get("insider_net_buy_lots", 0))
        if f.get("title"):
            titles.append(str(f["title"]))

    avg_sentiment = weighted_sentiment / max(1e-6, total_weight)
    insider_boost = float(np.clip(net_insider_lots / 250_000.0, -0.25, 0.25))

    if uma_triggered:
        # BEI Unusual Market Activity (UMA) alert suppresses positive drift and spikes ARB hazard
        mu_5d = float(np.clip(avg_sentiment - 0.25, -0.95, 0.15))
        h_arb = float(np.clip(0.72 + 0.20 * max(0.0, -avg_sentiment), 0.65, 0.96))
        liquidity_score = float(np.clip(-0.55 + 0.25 * avg_sentiment, -0.95, 0.20))
        theta_star = 0.85
    else:
        mu_5d = float(np.clip(avg_sentiment + 0.12 * insider_boost, -0.95, 0.96))
        # High public euphoria creates fast initial retail reaction (theta_star ~ 0.60 - 0.85)
        theta_star = float(np.clip(0.45 + 0.35 * abs(mu_5d), 0.20, 1.25))
        liquidity_score = float(np.clip(0.55 * mu_5d + 0.15, -0.90, 0.90))
        h_arb = float(np.clip(0.12 - 0.08 * mu_5d, 0.03, 0.55))

    headline = titles[0] if titles else "IDXNet Disclosure"
    rationale = (
        f"IDXNet [{headline}] -> NLP conviction mu_5d={mu_5d:+.2f}, UMA={uma_triggered}."
    )

    return StalkVector4D(
        agent_id="NLP",
        ticker=ticker,
        mu_5d=round(mu_5d, 6),
        theta_star=round(theta_star, 6),
        liquidity_score=round(liquidity_score, 6),
        h_arb=round(h_arb, 6),
        summary_rationale=rationale,
        diagnostics={
            "filing_count": len(filings),
            "avg_sentiment": round(avg_sentiment, 4),
            "uma_flag": uma_triggered,
            "net_insider_lots": net_insider_lots,
            "latest_headline": headline,
        },
    )
