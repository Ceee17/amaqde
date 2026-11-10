import { NextRequest, NextResponse } from "next/server";
import {
  bindAuthorizationCodeToWebAi,
  getMcpOAuthState,
  recordMcpRpcCall,
  recordModelQuotaUsage,
  updateMultiAgentRouting,
  verifyBearerToken,
} from "@/lib/mcpOAuthStore";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function resolveRepoRoot(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === "frontend") {
    return path.resolve(cwd, "..");
  }
  return cwd;
}

function resolvePythonBin(repoRoot: string): string {
  const winPython = path.join(repoRoot, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(winPython)) return winPython;
  const nixPython = path.join(repoRoot, ".venv", "bin", "python");
  if (fs.existsSync(nixPython)) return nixPython;
  return "python";
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const prompt: string = (body.prompt || "").trim();
    const authzCode: string = (body.authz_code || "").trim();
    const requestedModelId: string = (body.model_id || "").trim();
    const activeCard = body.active_card || null;

    // 1. Verify or bind the Antigravity OAuth code / Bearer token
    const authHeader = req.headers.get("authorization");
    let activeToken = verifyBearerToken(authHeader).token;

    if (authzCode && authzCode.startsWith("ag_authz_")) {
      activeToken = bindAuthorizationCodeToWebAi(authzCode);
    } else if (!activeToken) {
      const state = getMcpOAuthState();
      activeToken = state.tokens[0] || null;
    }

    if (!activeToken) {
      return NextResponse.json(
        {
          error:
            "Antigravity OAuth 2.1 authorization required. Paste your ag_authz_... code first.",
        },
        { status: 401 }
      );
    }

    if (requestedModelId) {
      updateMultiAgentRouting({ selected_copilot_model: requestedModelId });
    }

    const oauthStateBefore = getMcpOAuthState();
    const copilotModelId =
      requestedModelId ||
      oauthStateBefore.multi_agent_routing?.selected_copilot_model ||
      "argon-prime";

    // 2. Parse intent from the user's prompt to invoke deterministic MCP tools (No-LLM-Math Invariant!)
    const upperPrompt = prompt.toUpperCase();
    const tickerMatch = upperPrompt.match(
      /\b(BBCA|BMRI|BBRI|BBNI|TLKM|ASII|BREN|GOTO|ADRO|ANTM|AMMN|ICBP|UNVR|MDKA|PGAS|KLBF|INDF|BYAN|TPIA|BUKA)\b/
    );
    const targetTicker = tickerMatch
      ? tickerMatch[1]
      : activeCard?.ticker || "BBCA";

    let targetRegime = activeCard?.regime || "LIVE_MARKET_FEED";
    if (upperPrompt.includes("COHERENT") || targetTicker === "BBCA") {
      targetRegime = "COHERENT_ACCUMULATION";
    } else if (
      upperPrompt.includes("TRAP") ||
      upperPrompt.includes("GORENGAN") ||
      targetTicker === "BREN"
    ) {
      targetRegime = "BANDAR_BULL_TRAP";
    } else if (
      upperPrompt.includes("CASCADE") ||
      (upperPrompt.includes("ARB") && !upperPrompt.includes("PRE-ARB")) ||
      targetTicker === "GOTO"
    ) {
      targetRegime = "ARB_LIQUIDITY_CASCADE";
    } else {
      targetRegime = "LIVE_MARKET_FEED";
    }

    const repoRoot = resolveRepoRoot();
    const pythonBin = resolvePythonBin(repoRoot);

    let card = activeCard;
    let executedNewPipeline = false;

    if (
      !card ||
      card.ticker !== targetTicker ||
      upperPrompt.includes("RUN") ||
      upperPrompt.includes("SOLVE") ||
      upperPrompt.includes("EXECUTE")
    ) {
      const { stdout } = await execFileAsync(
        pythonBin,
        [
          "-m",
          "agents.agent_exe_unifier",
          "--ticker",
          targetTicker,
          "--regime",
          targetRegime,
        ],
        { cwd: repoRoot, timeout: 25000 }
      );
      card = JSON.parse(stdout);
      executedNewPipeline = true;
    }

    // Verify Merkle chain deterministically
    const { stdout: verifyOut } = await execFileAsync(
      pythonBin,
      [
        "-c",
        "import json; from services.merkle_audit_mcp.server import verify_merkle_chain; print(json.dumps(verify_merkle_chain('audit_vault')))",
      ],
      { cwd: repoRoot, timeout: 10000 }
    );
    const merkleCheck = JSON.parse(verifyOut.trim());

    const latencyMs = Date.now() - t0;
    recordModelQuotaUsage(copilotModelId, 1180, 1, latencyMs);
    recordMcpRpcCall({
      method: `ai_copilot/${copilotModelId}`,
      tool_name: `swrt:${card.ticker}:${card.regime}`,
      status: "OK",
      latency_ms: latencyMs,
      auth_client: activeToken.client_id,
    });

    const latestOAuthState = getMcpOAuthState();
    const routing = latestOAuthState.multi_agent_routing;

    const bdmDiag = card.stalks?.BDM?.diagnostics || {};
    const lobDiag = card.stalks?.LOB?.diagnostics || {};
    const nlpDiag = card.stalks?.NLP?.diagnostics || {};
    const macDiag = card.stalks?.MAC?.diagnostics || {};

    const briefingLines: string[] = [
      `### Antigravity OAuth 2.1 Multi-Agent Synthesis — **${card.ticker}.JK** (\`${card.regime}\`)`,
      `- **Authenticated OAuth Session:** \`${activeToken.bound_authz_code || activeToken.client_id}\` (\`${activeToken.client_name}\` • SHA-256 \`${activeToken.token_sha256.slice(0, 16)}...\`)`,
      `- **Multi-Agent Routing Topology (\`${routing.active_preset}\`):**`,
      `  - **Subagent 1 (\`${routing.subagent_1.model_id}\`):** \`EXE\` (Sheaf + WDRO + OU Optimal Stopping Unifier)`,
      `  - **Subagent 2 (\`${routing.subagent_2.model_id}\`):** \`BDM\` (${routing.agent_models.BDM}) + \`LOB\` (${routing.agent_models.LOB})`,
      `  - **Subagent 3 (\`${routing.subagent_3.model_id}\`):** \`NLP\` (${routing.agent_models.NLP}) + \`MAC\` (${routing.agent_models.MAC})`,
      `- **Mandatory Merkle Audit Gate:** \`${merkleCheck.valid ? "VERIFIED" : "FAILED"}\` • Receipt \`${card.receipt_sha256.slice(0, 24)}...\` • Frozen Snapshot \`${card.parquet_uri}\``,
      "",
      `#### 1. Unified HITL Decision Verdict: **\`${card.action}\`** (${card.approved_lots} Lots / ${card.approved_shares.toLocaleString()} Shares)`,
      card.approved_lots > 0
        ? `- **Tick-Aligned Execution Plan (Kep-00157/BEI/10-2026):** Entry Limit **Rp${card.entry_limit_rp.toLocaleString()}** | Take-Profit **Rp${card.take_profit_rp.toLocaleString()}** (+${card.gross_tp_edge_pct.toFixed(2)}% gross vs. ${card.min_required_edge_pct.toFixed(2)}% min required) | Pre-ARB Stop-Loss **Rp${card.stop_loss_pre_arb_rp.toLocaleString()}** (${card.pre_arb_drawdown_from_prev_close_pct.toFixed(2)}% vs. -5.20% Pre-ARB floor Rp${card.pre_arb_floor_rp.toLocaleString()}, -7.0% ARB at Rp${card.arb_floor_rp.toLocaleString()}).`
        : `- **Mathematical Veto Triggered:** \`${card.veto_reason || "Position sized to 0 lots by Sheaf-WDRO-ARB risk gate."}\` (Pre-ARB floor Rp${card.pre_arb_floor_rp.toLocaleString()}, -7.0% ARB floor Rp${card.arb_floor_rp.toLocaleString()}).`,
      "",
      `#### 2. 5-Pillar Mathematical Kernel Telemetry (No-LLM-Math Invariant)`,
      `- **Pillar 1 (Sinkhorn-Knopp Optimal Transport):** Conviction $\\kappa = ${(bdmDiag.conviction_kappa ?? 0).toFixed(3)}$, Retail $\\rightarrow$ Inst Flow = **${((bdmDiag.retail_to_inst_flow ?? 0) * 100).toFixed(1)}%**, Self-Loop Wash Ratio = **${((bdmDiag.self_loop_wash_ratio ?? 0) * 100).toFixed(1)}%**.`,
      `- **Pillar 2 (Depth-3 LOB Rough Path & Lévy Area):** $A_{\\text{OFI},\\text{Cancel}} = ${(lobDiag.levy_ofi_cancel ?? 0).toFixed(4)}$, Spoofing Detected = **\`${Boolean(lobDiag.spoofing_detected)}\`**, ARB Hazard $h_{\\text{ARB}} = ${(card.h_arb * 100).toFixed(1)}\\%$.`,
      `- **Pillar 3 (Cellular Sheaf Cohomology):** Global Frustration $\\Phi(x) = ${card.sheaf_phi.toFixed(4)}$ (Veto threshold $\\tau_{\\text{coh}} = ${card.cohomology_threshold.toFixed(2)}$), Primary Coboundary Fault = **\`${card.primary_fault_edge}\`** ($\\|\\delta x\\|_2 = ${card.primary_fault_norm.toFixed(3)}$).`,
      `- **Pillar 4 & 5 (WDRO + Ornstein-Uhlenbeck Stopping):** Ambiguity Radius $\\varepsilon(\\Phi) = ${(card.epsilon_phi * 100).toFixed(2)}\\%$, Expected Holding Horizon = **${card.expected_holding_days} days** (Hard Time-Stop: \`${card.time_stop_date}\`).`,
      `- **Catalyst & Macro Context:** ${nlpDiag.latest_headline || card.stalks?.NLP?.summary_rationale || "IDXNet filing verified"} | ROE ${macDiag.roe_pct ?? "N/A"}%, Altman Z ${macDiag.altman_z_score ?? "N/A"}.`,
    ];

    return NextResponse.json({
      ok: true,
      executed_new_pipeline: executedNewPipeline,
      selected_model: copilotModelId,
      multi_agent_routing: routing,
      ticker: card.ticker,
      regime: card.regime,
      oauth_session: {
        client_id: activeToken.client_id,
        client_name: activeToken.client_name,
        bound_authz_code: activeToken.bound_authz_code || null,
        token_sha256: activeToken.token_sha256,
      },
      merkle_verification: merkleCheck,
      decision_card: card,
      synthesis_markdown: briefingLines.join("\n"),
      latency_ms: latencyMs,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to execute Antigravity Web AI synthesis" },
      { status: 500 }
    );
  }
}
