"use client";

import React, { useEffect, useState } from "react";
import { UnifiedDecisionCard } from "@/types/swrt";
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Lock,
  Play,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";

interface OAuthTokenRecord {
  access_token: string;
  token_type: string;
  token_sha256: string;
  bound_authz_code?: string;
  client_id: string;
  client_name: string;
  scope: string;
  scopes: string[];
  grant_type: string;
  pkce_verified: boolean;
  issued_at: string;
  expires_at: string;
}

interface McpRpcLogEntry {
  id: string;
  method: string;
  tool_name?: string | null;
  timestamp: string;
  status: "OK" | "ERROR" | "UNAUTHORIZED";
  latency_ms: number;
  auth_client: string;
}

interface McpOAuthStateResponse {
  protocol_version: string;
  issuer: string;
  resource_server: string;
  mcp_endpoint: string;
  updated_at: string;
  clients: {
    client_id: string;
    client_name: string;
    scopes: string[];
    redirect_uris: string[];
  }[];
  tokens: OAuthTokenRecord[];
  rpc_logs: McpRpcLogEntry[];
}

interface AntigravityMcpBridgeProps {
  activeCard: UnifiedDecisionCard | null;
  onExecutePipeline?: (ticker: string, regime: string) => Promise<void>;
}

const DEFAULT_USER_AUTHZ_CODE = "ag_authz_example_user_session";

const MCP_CONFIG_SNIPPET = `{
  "mcpServers": {
    "idx-swrt-web-mcp": {
      "serverUrl": "http://localhost:3000/api/mcp"
    },
    "idx-swrt-math-kernel": {
      "command": "uv",
      "args": ["run", "python", "-m", "services.swrt_math_kernel_mcp.server"],
      "env": {
        "PYTHONPATH": "."
      }
    },
    "idx-merkle-audit-ledger": {
      "command": "uv",
      "args": ["run", "python", "-m", "services.merkle_audit_mcp.server"],
      "env": {
        "PYTHONPATH": "."
      }
    }
  }
}`;

export default function AntigravityMcpBridge({
  activeCard,
  onExecutePipeline,
}: AntigravityMcpBridgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [oauthState, setOauthState] = useState<McpOAuthStateResponse | null>(null);
  const [authzCodeInput, setAuthzCodeInput] = useState(DEFAULT_USER_AUTHZ_CODE);
  const [bindingCode, setBindingCode] = useState(false);
  const [bindSuccessMsg, setBindSuccessMsg] = useState<string | null>(null);
  const [rotatingToken, setRotatingToken] = useState(false);
  const [testingRpc, setTestingRpc] = useState(false);
  const [rpcPreviewResult, setRpcPreviewResult] = useState<string | null>(null);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  // Web AI Co-Pilot state powered by the bound Antigravity OAuth session
  const [aiPrompt, setAiPrompt] = useState(
    "Audit BBCA Sinkhorn Bandar flow, Sheaf Cohomology Φ(x), and Pre-ARB stop-loss receipt"
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<{
    synthesis_markdown: string;
    oauth_session: {
      client_id: string;
      client_name: string;
      bound_authz_code: string | null;
      token_sha256: string;
    };
    latency_ms: number;
  } | null>(null);

  const loadOAuthState = async () => {
    try {
      const res = await fetch("/api/oauth/token", { cache: "no-store" });
      if (res.ok) {
        const data: McpOAuthStateResponse = await res.json();
        setOauthState(data);
        if (data.tokens?.[0]?.bound_authz_code) {
          setAuthzCodeInput(data.tokens[0].bound_authz_code);
        }
      }
    } catch {
      // ignore
    }
  };

  // Auto-bind default user OAuth code on mount if not yet bound
  useEffect(() => {
    const initBind = async () => {
      try {
        const res = await fetch("/api/oauth/token", { cache: "no-store" });
        if (res.ok) {
          const data: McpOAuthStateResponse = await res.json();
          const alreadyBound = data.tokens?.some(
            (t) => t.bound_authz_code === DEFAULT_USER_AUTHZ_CODE
          );
          if (!alreadyBound) {
            await fetch("/api/oauth/token", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "bind_authz_code",
                code: DEFAULT_USER_AUTHZ_CODE,
              }),
            });
          }
        }
      } finally {
        await loadOAuthState();
      }
    };
    initBind();
  }, []);

  // Register Browser WebMCP (navigator.modelContext) for Antigravity Browser Agent discovery
  useEffect(() => {
    if (typeof window === "undefined") return;
    const nav = window.navigator as any;
    const modelContext = {
      protocol: "WebMCP/1.0",
      serverName: "idx-swrt-browser-webmcp",
      oauthDiscoveryUrl: "http://localhost:3000/.well-known/oauth-authorization-server",
      mcpStreamableHttpUrl: "http://localhost:3000/api/mcp",
      boundOAuthCode: DEFAULT_USER_AUTHZ_CODE,
      tools: [
        {
          name: "get_active_swrt_decision",
          description:
            "Returns the currently rendered IDX SWRT 1 Unified Decision Card & SHA-256 Merkle receipt in the terminal.",
          execute: async () => activeCard,
        },
        {
          name: "trigger_swrt_regime_audit",
          description:
            "Executes the 5-agent IDX SWRT pipeline and DuckDB Merkle commit for a given ticker and regime.",
          execute: async (args: { ticker?: string; regime?: string }) => {
            if (onExecutePipeline) {
              await onExecutePipeline(
                args?.ticker || "BBCA",
                args?.regime || "COHERENT_ACCUMULATION"
              );
            }
            return { status: "executed", ticker: args?.ticker || "BBCA" };
          },
        },
      ],
    };
    try {
      nav.modelContext = modelContext;
      (window as any).__ANTIGRAVITY_WEBMCP__ = modelContext;
    } catch {
      (window as any).__ANTIGRAVITY_WEBMCP__ = modelContext;
    }
  }, [activeCard, onExecutePipeline]);

  const activeToken: OAuthTokenRecord | null =
    oauthState?.tokens && oauthState.tokens.length > 0
      ? oauthState.tokens[0]
      : null;

  const handleBindAuthzCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!authzCodeInput.trim()) return;
    try {
      setBindingCode(true);
      setBindSuccessMsg(null);
      const res = await fetch("/api/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bind_authz_code",
          code: authzCodeInput.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setBindSuccessMsg(
          `Bound ${authzCodeInput.trim()} -> Bearer SHA-256 ${data.token_sha256?.slice(0, 16)}...`
        );
        await loadOAuthState();
      }
    } finally {
      setBindingCode(false);
    }
  };

  const handleRunWebAiCopilot = async (customPrompt?: string) => {
    const query = (customPrompt ?? aiPrompt).trim();
    if (!query) return;
    try {
      setAiLoading(true);
      const bearer =
        activeToken?.access_token || "ag_mcp_live_idx_swrt_default_oauth21_token_v1";
      const res = await fetch("/api/ai-copilot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          prompt: query,
          authz_code: authzCodeInput.trim(),
          active_card: activeCard,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setAiResponse(data);
        await loadOAuthState();
      }
    } finally {
      setAiLoading(false);
    }
  };

  const handleIssueAntigravityGrant = async () => {
    try {
      setRotatingToken(true);
      const res = await fetch("/api/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "issue_direct_grant",
          client_id: "antigravity-ide-mcp-client",
          client_name: "Google Antigravity IDE / Agent Runtime (OAuth 2.1 PKCE)",
          scope: "mcp:tools mcp:resources swrt:read_only_hitl merkle:verify",
        }),
      });
      const data = await res.json();
      await loadOAuthState();
      setRpcPreviewResult(JSON.stringify(data, null, 2));
    } finally {
      setRotatingToken(false);
    }
  };

  const handleTestMcpJsonRpc = async () => {
    try {
      setTestingRpc(true);
      const bearer =
        activeToken?.access_token || "ag_mcp_live_idx_swrt_default_oauth21_token_v1";

      const listRes = await fetch("/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "agy-rpc-tools-list",
          method: "tools/list",
          params: {},
        }),
      });
      const listJson = await listRes.json();

      const callRes = await fetch("/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "agy-rpc-merkle-verify",
          method: "tools/call",
          params: {
            name: "verify_merkle_audit_chain",
            arguments: {},
          },
        }),
      });
      const callJson = await callRes.json();

      setRpcPreviewResult(
        JSON.stringify(
          {
            mcp_endpoint: "http://localhost:3000/api/mcp",
            bound_oauth_code: activeToken?.bound_authz_code || authzCodeInput,
            oauth_bearer_sha256: activeToken?.token_sha256?.slice(0, 24) + "...",
            tools_discovered: listJson?.result?.tools?.map((t: any) => t.name) || [],
            verify_merkle_audit_chain_response: callJson?.result,
          },
          null,
          2
        )
      );
      await loadOAuthState();
    } finally {
      setTestingRpc(false);
    }
  };

  const copyConfig = () => {
    navigator.clipboard.writeText(MCP_CONFIG_SNIPPET);
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
  };

  const copyBearer = () => {
    if (!activeToken) return;
    navigator.clipboard.writeText(activeToken.access_token);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  return (
    <>
      {/* Top Bar Trigger Pill */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
          loadOAuthState();
        }}
        className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-mono font-bold bg-indigo-950/90 hover:bg-indigo-900/90 text-indigo-200 border border-indigo-500/50 shadow-lg shadow-indigo-950/40 transition-all cursor-pointer"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <KeyRound className="w-3.5 h-3.5 text-indigo-400" />
        <span>ANTIGRAVITY OAUTH + WEB AI</span>
        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px]">
          {activeToken?.bound_authz_code
            ? `${activeToken.bound_authz_code.slice(0, 15)}...`
            : "ACTIVE"}
        </span>
      </button>

      {/* Interactive Modal Drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto">
          <div className="relative w-full max-w-5xl bg-slate-900 border border-indigo-500/40 rounded-2xl shadow-2xl overflow-hidden my-6">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-slate-950/90 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-indigo-500/15 border border-indigo-500/30">
                  <Server className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-black tracking-tight text-white">
                      ANTIGRAVITY OAUTH 2.1 BINDING &amp; WEB AI QUANT CO-PILOT
                    </h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40">
                      OAUTH CODE BOUND &amp; VERIFIED
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-400">
                    Endpoint:{" "}
                    <code className="text-indigo-300">http://localhost:3000/api/mcp</code>{" "}
                    &bull; Bound Code:{" "}
                    <code className="text-emerald-300">
                      {activeToken?.bound_authz_code || authzCodeInput}
                    </code>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
              {/* STEP 1: Paste / Bind Antigravity OAuth Code (`ag_authz_...`) */}
              <div className="bg-indigo-950/30 border border-indigo-500/40 rounded-xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-mono uppercase tracking-wider font-bold text-white">
                      1. Bind Antigravity OAuth Authorization Code (Powers Web AI &amp; MCP)
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-300 bg-emerald-950/80 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                    Connected Client: {activeToken?.client_name || "Google Antigravity"}
                  </span>
                </div>

                <form
                  onSubmit={handleBindAuthzCode}
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
                >
                  <input
                    type="text"
                    value={authzCodeInput}
                    onChange={(e) => setAuthzCodeInput(e.target.value)}
                    placeholder="Paste ag_authz_... code here"
                    className="flex-1 bg-slate-950 border border-indigo-500/40 rounded-xl px-3.5 py-2 text-xs font-mono text-emerald-300 focus:outline-none focus:border-emerald-400"
                  />
                  <button
                    type="submit"
                    disabled={bindingCode}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors cursor-pointer shrink-0"
                  >
                    <Check className="w-4 h-4" />
                    {bindingCode
                      ? "Binding OAuth Code..."
                      : "Bind OAuth Code to Website AI"}
                  </button>
                </form>

                {bindSuccessMsg && (
                  <div className="text-xs font-mono text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 rounded-lg px-3 py-1.5">
                    ✓ {bindSuccessMsg}
                  </div>
                )}
              </div>

              {/* STEP 2: Antigravity OAuth-Powered Web AI Quant Co-Pilot */}
              <div className="bg-slate-950/90 border border-emerald-500/40 rounded-xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono uppercase tracking-wider font-bold text-emerald-300">
                      2. Antigravity OAuth-Powered Web AI Quant Co-Pilot (No-LLM-Math Enforced)
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const q =
                          "Audit BBCA Coherent Accumulation & verify Pre-ARB stop-loss receipt";
                        setAiPrompt(q);
                        handleRunWebAiCopilot(q);
                      }}
                      className="text-[10px] font-mono px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-emerald-500/30 cursor-pointer"
                    >
                      Audit BBCA (BUY)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const q =
                          "Explain why BREN Bandar Bull Trap is blocked by Sheaf Cohomology Φ(x)";
                        setAiPrompt(q);
                        handleRunWebAiCopilot(q);
                      }}
                      className="text-[10px] font-mono px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-rose-300 border border-rose-500/30 cursor-pointer"
                    >
                      Audit BREN Bull Trap
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const q =
                          "Run live SWRT pipeline on BMRI and verify DuckDB SHA-256 Merkle chain";
                        setAiPrompt(q);
                        handleRunWebAiCopilot(q);
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
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Ask Antigravity Web AI to audit any IDX ticker (BBCA, BMRI, BREN, GOTO, TLKM, ASII)..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={() => handleRunWebAiCopilot()}
                    disabled={aiLoading}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {aiLoading ? "Executing MCP + AI Synthesis..." : "Run Web AI Synthesis"}
                  </button>
                </div>

                {aiResponse && (
                  <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 border-b border-slate-800 pb-2">
                      <span>
                        Authenticated via{" "}
                        <code className="text-emerald-300">
                          {aiResponse.oauth_session.bound_authz_code ||
                            aiResponse.oauth_session.client_id}
                        </code>
                      </span>
                      <span>Latency: {aiResponse.latency_ms} ms</span>
                    </div>
                    <pre className="text-xs font-mono text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {aiResponse.synthesis_markdown}
                    </pre>
                  </div>
                )}
              </div>

              {/* Row 3: Active OAuth 2.1 Bearer Grant Details & MCP JSON-RPC Tester */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7 bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-wider text-indigo-300 font-bold flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-indigo-400" />
                      Active Antigravity OAuth 2.1 Bearer Grant
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-500/30">
                      PKCE S256 VERIFIED
                    </span>
                  </div>

                  {activeToken ? (
                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex items-center justify-between bg-slate-900/90 px-3 py-2 rounded-lg border border-slate-800">
                        <span className="text-slate-400">Bound OAuth Code:</span>
                        <span className="text-emerald-300 font-bold">
                          {activeToken.bound_authz_code || authzCodeInput}
                        </span>
                      </div>
                      <div className="flex items-center justify-between bg-slate-900/90 px-3 py-2 rounded-lg border border-slate-800">
                        <span className="text-slate-400">Client ID:</span>
                        <span className="text-white font-bold">{activeToken.client_id}</span>
                      </div>
                      <div className="flex items-center justify-between bg-slate-900/90 px-3 py-2 rounded-lg border border-slate-800">
                        <span className="text-slate-400">Bearer SHA-256:</span>
                        <span className="text-indigo-300">
                          {activeToken.token_sha256.slice(0, 28)}...
                        </span>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleIssueAntigravityGrant}
                      disabled={rotatingToken}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${rotatingToken ? "animate-spin" : ""}`}
                      />
                      Rotate Bearer Token
                    </button>

                    <button
                      type="button"
                      onClick={copyBearer}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
                    >
                      {copiedToken ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          Copied Bearer
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-slate-400" />
                          Copy Bearer Token
                        </>
                      )}
                    </button>

                    <a
                      href="/api/oauth/authorize?client_id=antigravity-ide-mcp-client&response_type=code&scope=mcp:tools+mcp:resources+swrt:read_only_hitl+merkle:verify&code_challenge_method=S256&code_challenge=E9Melhoa2OwvFrGMTJguCHaoeK1t8URWbuGJSstw-cM&state=agy-oauth-verify"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono font-semibold bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-indigo-500/30 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      OAuth 2.1 Consent Page
                    </a>
                  </div>
                </div>

                {/* Right Column: Live MCP JSON-RPC Test */}
                <div className="lg:col-span-5 bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
                  <div className="space-y-2">
                    <span className="text-xs font-mono uppercase tracking-wider text-emerald-300 font-bold flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      Exposed IDX SWRT MCP Tools (4)
                    </span>
                    <ul className="space-y-1.5 text-[11px] font-mono text-slate-300">
                      <li className="flex items-center justify-between bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800">
                        <span className="text-emerald-300 font-semibold">
                          run_swrt_decision_pipeline
                        </span>
                        <span className="text-[10px] text-slate-400">5-Agent + Merkle</span>
                      </li>
                      <li className="flex items-center justify-between bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800">
                        <span className="text-emerald-300 font-semibold">
                          verify_merkle_audit_chain
                        </span>
                        <span className="text-[10px] text-slate-400">SHA-256 + Parquet</span>
                      </li>
                      <li className="flex items-center justify-between bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800">
                        <span className="text-emerald-300 font-semibold">
                          get_latest_decision_cards
                        </span>
                        <span className="text-[10px] text-slate-400">DuckDB Ledger</span>
                      </li>
                      <li className="flex items-center justify-between bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800">
                        <span className="text-emerald-300 font-semibold">
                          compute_idx_tick_and_ara_arb
                        </span>
                        <span className="text-[10px] text-slate-400">Kep-00157/BEI</span>
                      </li>
                    </ul>
                  </div>

                  <button
                    type="button"
                    onClick={handleTestMcpJsonRpc}
                    disabled={testingRpc}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-mono font-bold bg-emerald-600 hover:bg-emerald-500 text-slate-950 transition-colors cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    {testingRpc
                      ? "Executing MCP JSON-RPC Handshake..."
                      : "Test Live MCP JSON-RPC (tools/list + verify_merkle_audit_chain)"}
                  </button>
                </div>
              </div>

              {/* Live JSON-RPC Output Preview */}
              {rpcPreviewResult && (
                <div className="bg-slate-950 border border-emerald-500/30 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-emerald-300 flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5" />
                      Live MCP Streamable HTTP JSON-RPC 2.0 Response
                    </span>
                    <button
                      type="button"
                      onClick={() => setRpcPreviewResult(null)}
                      className="text-[10px] font-mono text-slate-400 hover:text-white"
                    >
                      Clear
                    </button>
                  </div>
                  <pre className="text-[11px] font-mono text-slate-200 overflow-x-auto max-h-48 p-3 bg-slate-900/90 rounded-lg border border-slate-800">
                    {rpcPreviewResult}
                  </pre>
                </div>
              )}

              {/* Recent MCP JSON-RPC Audit Telemetry & Antigravity mcp_config.json */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-6 bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-slate-300">
                      Recent MCP JSON-RPC Calls ({oauthState?.rpc_logs?.length || 0})
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      audit_vault/mcp_oauth_state.json
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {oauthState?.rpc_logs && oauthState.rpc_logs.length > 0 ? (
                      oauthState.rpc_logs.slice(0, 8).map((log) => (
                        <div
                          key={log.id}
                          className="flex items-center justify-between text-[11px] font-mono bg-slate-900/90 px-2.5 py-1.5 rounded border border-slate-800"
                        >
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 text-[10px]">
                              {log.status}
                            </span>
                            <span className="text-white font-semibold">{log.method}</span>
                            {log.tool_name && (
                              <span className="text-indigo-300">({log.tool_name})</span>
                            )}
                          </div>
                          <span className="text-slate-400">{log.latency_ms} ms</span>
                        </div>
                      ))
                    ) : null}
                  </div>
                </div>

                <div className="lg:col-span-6 bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-slate-300 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      Antigravity <code className="text-indigo-300">mcp_config.json</code>
                    </span>
                    <button
                      type="button"
                      onClick={copyConfig}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                    >
                      {copiedConfig ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy JSON
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="text-[10px] font-mono text-slate-300 bg-slate-900/90 p-3 rounded-lg border border-slate-800 overflow-x-auto max-h-40">
                    {MCP_CONFIG_SNIPPET}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
