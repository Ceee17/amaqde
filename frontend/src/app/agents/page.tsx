"use client";

import React, { useEffect, useState } from "react";
import TopNavBar from "@/components/TopNavBar";
import MultiAgentOAuthCommandCenter from "@/components/MultiAgentOAuthCommandCenter";
import { UnifiedDecisionCard } from "@/types/swrt";

export default function AgentsAndModelsPage() {
  const [activeCard, setActiveCard] = useState<UnifiedDecisionCard | null>(null);
  const [runningRegime, setRunningRegime] = useState<string | null>(null);

  const loadLatestCard = async () => {
    try {
      const res = await fetch("/api/swrt", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.receipts && data.receipts.length > 0) {
          setActiveCard(data.receipts[0].decision);
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadLatestCard();
  }, []);

  const handleExecutePipeline = async (ticker: string, regime: string) => {
    try {
      setRunningRegime(regime);
      const res = await fetch("/api/swrt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, regime }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.receipts && data.receipts.length > 0) {
          setActiveCard(data.receipts[0].decision);
        }
      }
    } finally {
      setRunningRegime(null);
    }
  };

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <TopNavBar />

      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-1">
        <h1 className="text-xl font-bold text-white">
          AI Team &amp; Model Usage Settings
        </h1>
        <p className="text-xs text-slate-400">
          Your 5 specialist stock analysis agents run on your connected Google Antigravity OAuth account (1 Argon Lead AI + 2 Flash 3.8 Worker AIs). Choose your preferred AI model and check your daily usage limits below.
        </p>
      </div>

      <MultiAgentOAuthCommandCenter
        activeCard={activeCard}
        onExecutePipeline={handleExecutePipeline}
        runningRegime={runningRegime}
      />
    </main>
  );
}
