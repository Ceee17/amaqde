"use client";

import React, { useEffect, useState } from "react";
import { UnifiedDecisionCard } from "@/types/swrt";
import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
  Gauge,
  KeyRound,
  Layers,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

type AgentId = "BDM" | "LOB" | "NLP" | "MAC" | "EXE";

interface OAuthModelQuotaRecord {
  model_id: string;
  display_name: string;
  provider: string;
  tier: string;
  description: string;
  daily_request_limit: number;
  requests_used: number;
  remaining_requests: number;
  usage_pct: number;
  rpm_limit: number;
  tpm_limit: number;
  tokens_used: number;
  avg_latency_ms: number;
  status: "AVAILABLE" | "NEAR_LIMIT" | "RATE_LIMITED";
  oauth_unlocked: boolean;
  recommended_for: AgentId[];
}

interface SubagentSlotConfig {
  id: string;
  name: string;
  assigned_agents: AgentId[];
  model_id: string;
  role: string;
}

interface MultiAgentRoutingConfig {
  active_preset: string;
  selected_copilot_model: string;
  oauth_bound_code: string;
  subagent_1: SubagentSlotConfig;
  subagent_2: SubagentSlotConfig;
  subagent_3: SubagentSlotConfig;
  subagents: SubagentSlotConfig[];
  agent_models: Record<AgentId, string>;
  updated_at: string;
}

interface BoundOAuthInfo {
  bound_authz_code: string;
  client_id: string;
  client_name: string;
  token_sha256: string;
  scopes: string[];
  pkce_verified: boolean;
}

interface MultiAgentOAuthCommandCenterProps {
  activeCard: UnifiedDecisionCard | null;
  onExecutePipeline: (ticker: string, regime: string) => Promise<void>;
  runningRegime: string | null;
}

const PRESET_OPTIONS = [
  {
    id: "1_ARGON_2_FLASH",
    label: "1 Argon + 2 Flash 3.8 (Recommended)",
    desc: "Subagent 1: Argon (EXE) • Subagents 2 & 3: Flash 3.8 (BDM, LOB, NLP, MAC)",
  },
  {
    id: "ALL_FLASH_3_8",
    label: "All Flash 3.8 High-Throughput",
    desc: "All 3 Subagents & 5 Stalk Agents on Gemini 3.8 Flash",
  },
  {
    id: "HYBRID_PRO_FLASH",
    label: "Hybrid Argon + Gemini Pro + Flash 3.8",
    desc: "EXE: Argon • BDM/LOB: Flash 3.8 • NLP/MAC: Gemini 3.1 Pro",
  },
  {
    id: "ALL_ARGON_PRIME",
    label: "All Argon Prime Deep Reasoning",
    desc: "Maximum reasoning depth across all 5 agents",
  },
] as const;

export default function MultiAgentOAuthCommandCenter({
  activeCard,
  onExecutePipeline,
  runningRegime,
}: MultiAgentOAuthCommandCenterProps) {
  const [expanded, setExpanded] = useState(true);
  const [boundOAuth, setBoundOAuth] = useState<BoundOAuthInfo | null>(null);
  const [models, setModels] = useState<OAuthModelQuotaRecord[]>([]);
  const [routing, setRouting] = useState<MultiAgentRoutingConfig | null>(null);
  const [authzInput, setAuthzInput] = useState(
    "ag_authz_example_user_session"
  );
  const [savingConfig, setSavingConfig] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Embedded Web AI Co-Pilot prompt powered by the selected OAuth model
  const [copilotPrompt, setCopilotPrompt] = useState(
    "Audit BBCA Coherent Accumulation & verify Pre-ARB stop-loss receipt"
  );
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotOutput, setCopilotOutput] = useState<string | null>(null);

  const fetchModelState = async () => {
    try {
      const res = await fetch("/api/oauth/models", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setBoundOAuth(data.bound_oauth);
      setModels(data.available_models || []);
      setRouting(data.multi_agent_routing || null);
      if (data.bound_oauth?.bound_authz_code) {
        setAuthzInput(data.bound_oauth.bound_authz_code);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchModelState();
  }, [activeCard?.receipt_sha256]);

  const updateRoutingServer = async (payload: Record<string, any>, message?: string) => {
    try {
      setSavingConfig(true);
      const res = await fetch("/api/oauth/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        setBoundOAuth(data.bound_oauth);
        setModels(data.available_models || []);
        setRouting(data.multi_agent_routing || null);
        if (message) {
          setStatusBanner(message);
          setTimeout(() => setStatusBanner(null), 3500);
        }
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const handleBindCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authzInput.trim()) return;
    await updateRoutingServer(
      { authz_code: authzInput.trim() },
      `Bound OAuth Code ${authzInput.trim()} to all 5 IDX SWRT Agents & 3 Subagents`
    );
  };

  const handleSelectPreset = async (presetId: string) => {
    await updateRoutingServer(
      { preset: presetId },
      `Activated Multi-Agent Preset: ${presetId}`
    );
  };

  const handleSelectCopilotModel = async (modelId: string) => {
    await updateRoutingServer(
      { selected_copilot_model: modelId },
      `Selected Web AI Model: ${modelId}`
    );
  };

  const handleChangeSubagentModel = async (
    slotKey: "subagent_1" | "subagent_2" | "subagent_3",
    modelId: string
  ) => {
    await updateRoutingServer(
      {
        preset: "CUSTOM",
        subagent_models: { [slotKey]: modelId },
      },
      `Updated ${slotKey.toUpperCase()} model -> ${modelId}`
    );
  };

  const handleChangeAgentModel = async (agentId: AgentId, modelId: string) => {
    await updateRoutingServer(
      {
        preset: "CUSTOM",
        agent_models: { [agentId]: modelId },
      },
      `Assigned Agent ${agentId} -> ${modelId}`
    );
  };

  const handleRunCopilot = async (customQuery?: string) => {
    const q = (customQuery ?? copilotPrompt).trim();
    if (!q) return;
    try {
      setCopilotLoading(true);
      const res = await fetch("/api/ai-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: q,
          authz_code: authzInput.trim(),
          model_id: routing?.selected_copilot_model || "argon-prime",
          active_card: activeCard,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCopilotOutput(data.synthesis_markdown);
        await fetchModelState();
      }
    } finally {
      setCopilotLoading(false);
    }
  };

  const totalRequestsUsed = models.reduce((acc, m) => acc + (m.requests_used || 0), 0);
  const totalDailyLimit = models.reduce(
    (acc, m) => acc + (m.daily_request_limit || 0),
    0
  );
  const totalRemaining = Math.max(0, totalDailyLimit - totalRequestsUsed);

  const cardAgentExecutions =
    (activeCard?.pillar_diagnostics as any)?.oauth_multi_agent?.agent_executions || {};

  return (
    <section className="bg-slate-900/95 backdrop-blur-md border border-indigo-500/35 rounded-2xl shadow-2xl overflow-hidden">
      {/* Top Always-Visible Command Bar */}
      <div className="px-4 sm:px-5 py-3.5 bg-gradient-to-r from-slate-950 via-indigo-950/40 to-slate-950 border-b border-slate-800/90 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-500/40">
            <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
            OAUTH BOUND:{" "}
            <code className="text-emerald-300">
              {boundOAuth?.bound_authz_code || authzInput}
            </code>
          </span>

          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            TOPOLOGY:{" "}
            <strong className="text-white">
              {routing?.active_preset === "1_ARGON_2_FLASH"
                ? "1 Argon + 2 Flash 3.8 Subagents"
                : routing?.active_preset || "1 Argon + 2 Flash 3.8"}
            </strong>
          </span>

          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-500/30">
            <Gauge className="w-3.5 h-3.5 text-cyan-400" />
            QUOTA:{" "}
            <strong className="text-white">
              {totalRemaining.toLocaleString()} / {totalDailyLimit.toLocaleString()}
            </strong>{" "}
            reqs remaining
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Inline OAuth Code Binder */}
          <form onSubmit={handleBindCode} className="flex items-center gap-1.5">
            <input
              type="text"
              value={authzInput}
              onChange={(e) => setAuthzInput(e.target.value)}
              placeholder="Paste ag_authz_... OAuth code"
              className="w-56 sm:w-64 bg-slate-950 border border-indigo-500/40 rounded-lg px-2.5 py-1 text-[11px] font-mono text-emerald-300 focus:outline-none focus:border-emerald-400"
            />
            <button
              type="submit"
              disabled={savingConfig}
              className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer"
            >
              Bind OAuth
            </button>
          </form>

          <button
            type="button"
            onClick={() =>
              onExecutePipeline(
                activeCard?.ticker || "BBCA",
                activeCard?.regime || "COHERENT_ACCUMULATION"
              )
            }
            disabled={runningRegime !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-mono font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors cursor-pointer"
          >
            {runningRegime ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            Run Multi-Agent Solve
          </button>

          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
          >
            {expanded ? (
              <>
                Hide Models &amp; Quotas <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                Models, Limits &amp; Subagents <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {statusBanner && (
        <div className="px-5 py-2 bg-emerald-950/80 border-b border-emerald-500/30 text-xs font-mono text-emerald-300 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{statusBanner}</span>
        </div>
      )}

      {/* Expandable Multi-Agent & Model Quota Body */}
      {expanded && (
        <div className="p-4 sm:p-5 space-y-5">
          {/* Grid Row 1: Available OAuth Models + Usage Limits (Left 7 cols) & 3-Subagent Load Distribution (Right 5 cols) */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
            {/* Left 7 Cols: Available Models, Usage Limits & Selector */}
            <div className="xl:col-span-7 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono uppercase tracking-wider font-bold text-indigo-300 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-indigo-400" />
                  Available OAuth-Unlocked Models &amp; Real-Time Usage Limits (
                  {models.length})
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  Active Web AI Model:{" "}
                  <strong className="text-emerald-300">
                    {routing?.selected_copilot_model || "argon-prime"}
                  </strong>
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {models.map((m) => {
                  const isSelectedCopilot =
                    routing?.selected_copilot_model === m.model_id;
                  const usedPct = Math.min(
                    100,
                    m.daily_request_limit > 0
                      ? (m.requests_used / m.daily_request_limit) * 100
                      : 0
                  );

                  // Find which agents currently use this model
                  const assignedAgents = routing
                    ? (Object.keys(routing.agent_models) as AgentId[]).filter(
                        (ag) => routing.agent_models[ag] === m.model_id
                      )
                    : [];

                  return (
                    <div
                      key={m.model_id}
                      className={`rounded-xl p-3.5 border transition-all flex flex-col justify-between gap-2.5 ${
                        isSelectedCopilot
                          ? "bg-indigo-950/40 border-indigo-400/70 shadow-lg shadow-indigo-950/50"
                          : "bg-slate-950/85 border-slate-800/90 hover:border-slate-700"
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-mono font-bold text-white">
                                {m.display_name}
                              </span>
                            </div>
                            <div className="text-[10px] font-mono text-slate-400">
                              ID: <code className="text-indigo-300">{m.model_id}</code> &bull;{" "}
                              {m.tier}
                            </div>
                          </div>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/30 shrink-0">
                            {m.status}
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-300 leading-snug">
                          {m.description}
                        </p>

                        {/* Usage Limit Bar */}
                        <div className="space-y-1 pt-1">
                          <div className="flex items-center justify-between text-[10px] font-mono">
                            <span className="text-slate-400">
                              Used:{" "}
                              <strong className="text-white">
                                {m.requests_used.toLocaleString()}
                              </strong>{" "}
                              / {m.daily_request_limit.toLocaleString()} req/day
                            </span>
                            <span className="text-emerald-300 font-bold">
                              {m.remaining_requests.toLocaleString()} left (
                              {(100 - usedPct).toFixed(1)}%)
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-emerald-400 to-indigo-400 rounded-full transition-all"
                              style={{ width: `${Math.max(3, usedPct)}%` }}
                            />
                          </div>
                        </div>

                        {/* Rate Limits & Tokens Telemetry */}
                        <div className="grid grid-cols-3 gap-1.5 pt-1 text-[10px] font-mono">
                          <div className="bg-slate-900/90 px-2 py-1 rounded border border-slate-800/80">
                            <span className="text-slate-500 block">RPM Limit</span>
                            <span className="text-slate-200 font-bold">
                              {m.rpm_limit} RPM
                            </span>
                          </div>
                          <div className="bg-slate-900/90 px-2 py-1 rounded border border-slate-800/80">
                            <span className="text-slate-500 block">Tokens Used</span>
                            <span className="text-slate-200 font-bold">
                              {(m.tokens_used / 1000).toFixed(1)}k /{" "}
                              {(m.tpm_limit / 1000000).toFixed(0)}M
                            </span>
                          </div>
                          <div className="bg-slate-900/90 px-2 py-1 rounded border border-slate-800/80">
                            <span className="text-slate-500 block">Avg Latency</span>
                            <span className="text-emerald-300 font-bold">
                              {m.avg_latency_ms} ms
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
                        <div className="flex flex-wrap gap-1">
                          {assignedAgents.length > 0 ? (
                            assignedAgents.map((ag) => (
                              <span
                                key={ag}
                                className="px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-500/30 text-[10px] font-mono font-bold"
                              >
                                {ag}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] font-mono text-slate-500">
                              Standby
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleSelectCopilotModel(m.model_id)}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-colors cursor-pointer ${
                            isSelectedCopilot
                              ? "bg-emerald-500 text-slate-950"
                              : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                          }`}
                        >
                          {isSelectedCopilot ? "✓ Active Web AI" : "Use for Web AI"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right 5 Cols: 3-Subagent Load Distribution (1 Argon + 2 Flash 3.8) & 5-Agent Stalk Router */}
            <div className="xl:col-span-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono uppercase tracking-wider font-bold text-emerald-300 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  3-Subagent Load Distribution &amp; 5-Agent Stalk Router
                </h3>
                <span className="text-[10px] font-mono text-slate-400">
                  All Agents Authenticated via OAuth
                </span>
              </div>

              {/* Preset Buttons */}
              <div className="grid grid-cols-2 gap-2">
                {PRESET_OPTIONS.map((p) => {
                  const active = routing?.active_preset === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectPreset(p.id)}
                      className={`text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                        active
                          ? "bg-emerald-950/50 border-emerald-400/70 text-white"
                          : "bg-slate-950/80 border-slate-800 hover:border-slate-700 text-slate-300"
                      }`}
                    >
                      <div className="text-[11px] font-mono font-bold flex items-center justify-between">
                        <span>{p.label}</span>
                        {active && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5 line-clamp-1">
                        {p.desc}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* 3 Subagent Slots */}
              {routing && (
                <div className="space-y-2.5">
                  {(
                    [
                      { key: "subagent_1", slot: routing.subagent_1, badge: "SUBAGENT 1 (ORCHESTRATOR)" },
                      { key: "subagent_2", slot: routing.subagent_2, badge: "SUBAGENT 2 (WORKER A)" },
                      { key: "subagent_3", slot: routing.subagent_3, badge: "SUBAGENT 3 (WORKER B)" },
                    ] as const
                  ).map(({ key, slot, badge }) => (
                    <div
                      key={slot.id}
                      className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-500/30">
                            {badge}
                          </span>
                          <div className="text-xs font-mono font-bold text-white mt-1">
                            {slot.name}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            {slot.role}
                          </div>
                        </div>

                        <select
                          value={slot.model_id}
                          onChange={(e) =>
                            handleChangeSubagentModel(key, e.target.value)
                          }
                          className="bg-slate-900 border border-indigo-500/40 rounded-lg px-2.5 py-1.5 text-xs font-mono text-emerald-300 focus:outline-none focus:border-emerald-400"
                        >
                          {models.map((m) => (
                            <option key={m.model_id} value={m.model_id}>
                              {m.display_name} ({m.remaining_requests} left)
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Assigned Stalk Agents */}
                      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/80">
                        <span className="text-[10px] font-mono text-slate-400">
                          Stalk Agents:
                        </span>
                        {slot.assigned_agents.map((ag) => (
                          <div
                            key={ag}
                            className="inline-flex items-center gap-1.5 bg-slate-900 px-2 py-1 rounded border border-slate-800 text-[10px] font-mono"
                          >
                            <span className="font-bold text-emerald-300">{ag}</span>
                            <span className="text-slate-500">&rarr;</span>
                            <select
                              value={routing.agent_models[ag]}
                              onChange={(e) =>
                                handleChangeAgentModel(ag, e.target.value)
                              }
                              className="bg-transparent text-indigo-300 font-semibold focus:outline-none cursor-pointer"
                            >
                              {models.map((m) => (
                                <option
                                  key={m.model_id}
                                  value={m.model_id}
                                  className="bg-slate-900 text-white"
                                >
                                  {m.model_id}
                                </option>
                              ))}
                            </select>
                            {cardAgentExecutions[ag] && (
                              <span className="text-slate-400">
                                ({cardAgentExecutions[ag].tokens_used} tok)
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Interactive Web AI Co-Pilot Bar Using the Chosen Model & Bound OAuth */}
          <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-mono font-bold text-white">
                  Antigravity OAuth Web AI Co-Pilot (Running on{" "}
                  <code className="text-emerald-300">
                    {routing?.selected_copilot_model || "argon-prime"}
                  </code>{" "}
                  via <code className="text-indigo-300">{boundOAuth?.bound_authz_code}</code>)
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const q =
                      "Run BBCA Coherent Accumulation & verify Pre-ARB stop-loss receipt";
                    setCopilotPrompt(q);
                    handleRunCopilot(q);
                  }}
                  className="text-[10px] font-mono px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-emerald-500/30 cursor-pointer"
                >
                  Audit BBCA
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const q =
                      "Explain why BREN Bandar Bull Trap is blocked by Sheaf Cohomology Φ(x)";
                    setCopilotPrompt(q);
                    handleRunCopilot(q);
                  }}
                  className="text-[10px] font-mono px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-rose-300 border border-rose-500/30 cursor-pointer"
                >
                  Audit BREN Bull Trap
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const q =
                      "Solve BMRI Live Market Feed with 1 Argon + 2 Flash 3.8 subagents";
                    setCopilotPrompt(q);
                    handleRunCopilot(q);
                  }}
                  className="text-[10px] font-mono px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/30 cursor-pointer"
                >
                  Solve BMRI Live
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={copilotPrompt}
                onChange={(e) => setCopilotPrompt(e.target.value)}
                placeholder="Ask the OAuth-authenticated multi-agent system to audit any IDX ticker..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
              />
              <button
                type="button"
                onClick={() => handleRunCopilot()}
                disabled={copilotLoading}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                {copilotLoading
                  ? "Running Multi-Agent OAuth Synthesis..."
                  : "Ask Multi-Agent Web AI"}
              </button>
            </div>

            {copilotOutput && (
              <pre className="text-xs font-mono text-slate-200 whitespace-pre-wrap leading-relaxed bg-slate-900/95 border border-slate-800 rounded-xl p-3.5 max-h-60 overflow-y-auto">
                {copilotOutput}
              </pre>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
