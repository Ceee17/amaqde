import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  getMcpOAuthState,
  recordMcpRpcCall,
  verifyBearerToken,
} from "@/lib/mcpOAuthStore";

function resolveRepoRoot(): string {
  const parentVault = path.resolve(process.cwd(), "..", "audit_vault");
  if (fs.existsSync(parentVault) || path.basename(process.cwd()) === "frontend") {
    return path.resolve(process.cwd(), "..");
  }
  return process.cwd();
}

const REPO_ROOT = resolveRepoRoot();
const MIRROR_FILE = path.join(REPO_ROOT, "audit_vault", "latest_receipts.json");

function resolvePythonExecutable(): { cmd: string; prefixArgs: string[] } {
  const winVenv = path.join(REPO_ROOT, ".venv", "Scripts", "python.exe");
  const unixVenv = path.join(REPO_ROOT, ".venv", "bin", "python");
  if (fs.existsSync(winVenv)) {
    return { cmd: winVenv, prefixArgs: [] };
  }
  if (fs.existsSync(unixVenv)) {
    return { cmd: unixVenv, prefixArgs: [] };
  }
  return { cmd: "uv", prefixArgs: ["run", "python"] };
}

function runPythonModule(args: string[]): string {
  const { cmd, prefixArgs } = resolvePythonExecutable();
  return execFileSync(cmd, [...prefixArgs, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function corsHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
    ...extra,
  };
}

function unauthorizedOAuthResponse(origin: string): NextResponse {
  const resourceMetaUrl = `${origin}/.well-known/oauth-protected-resource`;
  const wwwAuth = `Bearer realm="idx-swrt-engine-mcp", resource_metadata="${resourceMetaUrl}", scope="mcp:tools mcp:resources swrt:read_only_hitl merkle:verify"`;
  return NextResponse.json(
    {
      error: "unauthorized",
      error_description:
        "OAuth 2.1 Bearer token required. Discover metadata at /.well-known/oauth-protected-resource and /.well-known/oauth-authorization-server",
      resource_metadata: resourceMetaUrl,
    },
    {
      status: 401,
      headers: corsHeaders({
        "WWW-Authenticate": wwwAuth,
      }),
    }
  );
}

/**
 * Deterministic IDX Tick Size & Asymmetric ARA/ARB Calculator
 * (Matches `services/swrt_math_kernel_mcp/idx_rules.py` Kep-00157/BEI/10-2026)
 */
function getIdxTickSize(priceRp: number): number {
  if (priceRp < 200) return 1;
  if (priceRp < 500) return 2;
  if (priceRp < 2000) return 5;
  if (priceRp < 5000) return 10;
  return 25;
}

function roundToIdxTick(
  priceRp: number,
  mode: "nearest" | "floor" | "ceil" = "nearest"
): number {
  if (priceRp <= 1) return 1;
  const tick = getIdxTickSize(priceRp);
  let rounded: number;
  if (mode === "floor") {
    rounded = Math.floor((priceRp + 1e-9) / tick) * tick;
  } else if (mode === "ceil") {
    rounded = Math.ceil((priceRp - 1e-9) / tick) * tick;
  } else {
    rounded = Math.round(priceRp / tick) * tick;
  }
  rounded = Math.max(1, rounded);
  const newTick = getIdxTickSize(rounded);
  if (rounded % newTick !== 0) {
    if (mode === "floor") {
      rounded = Math.floor(rounded / newTick) * newTick;
    } else if (mode === "ceil") {
      rounded = Math.ceil(rounded / newTick) * newTick;
    } else {
      rounded = Math.round(rounded / newTick) * newTick;
    }
  }
  return Math.max(1, rounded);
}

function computeIdxTickAndAraArb(priceRp: number, prevCloseRp: number) {
  const cleanPrev = roundToIdxTick(prevCloseRp, "nearest");
  const cleanPrice = roundToIdxTick(priceRp, "nearest");
  const tickSize = getIdxTickSize(cleanPrice);
  const araPct = cleanPrev <= 200 ? 0.35 : cleanPrev <= 5000 ? 0.25 : 0.2;
  const arbPct = 0.07;
  const preArbMaxDrawdownPct = 0.052;

  const araRp = Math.max(50, roundToIdxTick(cleanPrev * (1 + araPct), "floor"));
  const arbRp = Math.max(
    cleanPrev >= 50 ? 50 : 1,
    roundToIdxTick(cleanPrev * (1 - arbPct), "ceil")
  );
  const preArbStopFloorRp = Math.max(
    arbRp,
    roundToIdxTick(cleanPrev * (1 - preArbMaxDrawdownPct), "ceil")
  );

  return {
    input_price_rp: priceRp,
    tick_aligned_price_rp: cleanPrice,
    tick_size_rp: tickSize,
    is_input_tick_aligned: priceRp === cleanPrice,
    prev_close_rp: cleanPrev,
    ara_pct: araPct,
    arb_pct: arbPct,
    ara_ceiling_rp: araRp,
    arb_floor_rp: arbRp,
    pre_arb_stop_loss_floor_rp: preArbStopFloorRp,
    idx_lot_shares: 100,
    round_trip_fee_pct: 0.004,
    regulation: "Kep-00157/BEI/10-2026",
  };
}

const MCP_TOOLS = [
  {
    name: "run_swrt_decision_pipeline",
    description:
      "Execute the 5-Agent IDX SWRT Quantitative Decision Pipeline (Sinkhorn-Knopp Optimal Transport, Depth-3 Rough Path LOB Signatures, Cellular Sheaf Laplacian Cohomology, WDRO Lot Sizer, and OU First-Passage Optimal Stopping) and commit a SHA-256 Merkle-chained receipt to DuckDB + zstd Parquet.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: {
          type: "string",
          description: "IDX 4-letter stock ticker symbol (e.g. BBCA, BREN, GOTO, BMRI, TLKM, AMMN)",
          default: "BBCA",
        },
        regime: {
          type: "string",
          enum: [
            "COHERENT_ACCUMULATION",
            "BANDAR_BULL_TRAP",
            "ARB_LIQUIDITY_CASCADE",
            "LIVE_MARKET_FEED",
          ],
          description: "Market microstructure regime or JIT live market feed",
          default: "COHERENT_ACCUMULATION",
        },
        capital_rp: {
          type: "number",
          description: "Portfolio allocation capital in Indonesian Rupiah (IDR)",
          default: 100000000,
        },
      },
      required: ["ticker", "regime"],
    },
  },
  {
    name: "verify_merkle_audit_chain",
    description:
      "Cryptographically verify the entire local DuckDB SHA-256 Merkle receipt chain from genesis to head and validate every linked zstd Parquet raw orderbook snapshot on disk.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_latest_decision_cards",
    description:
      "Retrieve the most recent Merkle-verified Unified Decision Cards from the IDX SWRT audit vault, optionally filtered by ticker.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of decision receipts to return (1-50)",
          default: 10,
        },
        ticker: {
          type: "string",
          description: "Optional IDX ticker filter (e.g. BBCA, BREN, GOTO)",
        },
      },
      required: [],
    },
  },
  {
    name: "compute_idx_tick_and_ara_arb",
    description:
      "Deterministic IDX Fraksi Harga tick-size rounder and Kep-00157/BEI/10-2026 ARA (+35%/+25%/+20%), ARB (-7%), and Pre-ARB (-5.2%) circuit-breaker boundary calculator.",
    inputSchema: {
      type: "object",
      properties: {
        price_rp: {
          type: "number",
          description: "Target Rupiah price to align to IDX Fraksi Harga tick size",
        },
        prev_close_rp: {
          type: "number",
          description: "Previous closing price in Rupiah used for ARA/ARB boundary calculation",
        },
      },
      required: ["price_rp", "prev_close_rp"],
    },
  },
];

const MCP_RESOURCES = [
  {
    uri: "audit://idx-swrt/ledger/latest",
    name: "IDX SWRT Forensic Merkle Audit Ledger",
    description:
      "Live SHA-256 Merkle chain verification status and latest DuckDB/Parquet audited decision receipts.",
    mimeType: "application/json",
  },
  {
    uri: "audit://idx-swrt/oauth/status",
    name: "Antigravity OAuth 2.1 + PKCE Session & Telemetry State",
    description:
      "Active OAuth 2.1 clients, PKCE S256 grants, Bearer token SHA-256 fingerprints, and MCP JSON-RPC audit logs.",
    mimeType: "application/json",
  },
];

function loadAuditVaultMirror(): any {
  if (!fs.existsSync(MIRROR_FILE)) {
    runPythonModule(["-m", "agents.agent_exe_unifier", "--run-all-regimes"]);
  }
  const raw = fs.readFileSync(MIRROR_FILE, "utf-8");
  return JSON.parse(raw);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function DELETE(req: NextRequest) {
  const sessionId =
    req.headers.get("mcp-session-id") || `mcp-sess-${crypto.randomBytes(6).toString("hex")}`;
  return NextResponse.json(
    {
      status: "session_closed",
      mcp_session_id: sessionId,
    },
    {
      status: 200,
      headers: corsHeaders({ "Mcp-Session-Id": sessionId }),
    }
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;
  const requireOAuth = url.searchParams.get("require_oauth") === "1";
  const authHeader = req.headers.get("authorization");

  const authCheck = verifyBearerToken(authHeader, { strict: requireOAuth });
  if (!authCheck.authenticated) {
    recordMcpRpcCall({
      method: "GET /api/mcp (OAuth Challenge)",
      tool_name: null,
      status: "UNAUTHORIZED",
      latency_ms: 1,
      auth_client: "unauthenticated-probe",
    });
    return unauthorizedOAuthResponse(origin);
  }

  const oauthState = getMcpOAuthState();
  const activeToken = authCheck.token;
  const sessionId =
    req.headers.get("mcp-session-id") ||
    `ag-mcp-${activeToken?.token_sha256.slice(0, 12) || "default"}`;

  return NextResponse.json(
    {
      protocol: "Model Context Protocol (MCP) Streamable HTTP",
      protocolVersion: "2025-03-26",
      serverInfo: {
        name: "idx-swrt-engine-mcp",
        title: "IDX SWRT Quantitative Decision Engine & Merkle Audit MCP",
        version: "1.0.0",
      },
      transport: {
        type: "streamable-http",
        endpoint: `${origin}/api/mcp`,
        mcp_session_id: sessionId,
      },
      oauth21: {
        enabled: true,
        pkce_s256_enforced: true,
        protected_resource_metadata: `${origin}/.well-known/oauth-protected-resource`,
        authorization_server_metadata: `${origin}/.well-known/oauth-authorization-server`,
        authorization_endpoint: `${origin}/api/oauth/authorize`,
        token_endpoint: `${origin}/api/oauth/token`,
        registration_endpoint: `${origin}/api/oauth/register`,
        authenticated_mode: authCheck.mode,
        active_grant: activeToken
          ? {
              client_id: activeToken.client_id,
              client_name: activeToken.client_name,
              token_sha256: activeToken.token_sha256,
              token_preview: `${activeToken.access_token.slice(0, 18)}...${activeToken.access_token.slice(-6)}`,
              scopes: activeToken.scopes,
              grant_type: activeToken.grant_type,
              pkce_verified: activeToken.pkce_verified,
              issued_at: activeToken.issued_at,
              expires_at: activeToken.expires_at,
            }
          : null,
        registered_clients_count: oauthState.clients.length,
        issued_tokens_count: oauthState.tokens.length,
      },
      tools: MCP_TOOLS,
      resources: MCP_RESOURCES,
      recent_rpc_logs: oauthState.rpc_logs.slice(0, 15),
    },
    {
      status: 200,
      headers: corsHeaders({
        "Mcp-Session-Id": sessionId,
      }),
    }
  );
}

export async function POST(req: NextRequest) {
  const startMs = performance.now();
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;
  const requireOAuth = url.searchParams.get("require_oauth") === "1";
  const authHeader = req.headers.get("authorization");

  const authCheck = verifyBearerToken(authHeader, { strict: requireOAuth });
  if (!authCheck.authenticated) {
    recordMcpRpcCall({
      method: "POST /api/mcp (401 WWW-Authenticate)",
      tool_name: null,
      status: "UNAUTHORIZED",
      latency_ms: performance.now() - startMs,
      auth_client: "unauthenticated-client",
    });
    return unauthorizedOAuthResponse(origin);
  }

  const activeClient = authCheck.token?.client_id || "antigravity-ide-mcp-client";
  const sessionId =
    req.headers.get("mcp-session-id") ||
    `ag-mcp-${authCheck.token?.token_sha256.slice(0, 12) || "session"}`;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error: Invalid JSON payload" },
      },
      { status: 400, headers: corsHeaders({ "Mcp-Session-Id": sessionId }) }
    );
  }

  const rpcId = body?.id !== undefined ? body.id : null;
  const method = String(body?.method || "");
  const params = body?.params || {};

  try {
    if (method === "initialize") {
      const result = {
        protocolVersion: "2025-03-26",
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: {
          name: "idx-swrt-engine-mcp",
          version: "1.0.0",
        },
        instructions:
          "IDX SWRT Quantitative Decision Engine (5-Agent Sheaf-WDRO-Stopping Kernel + DuckDB/Parquet SHA-256 Merkle Audit Vault). All trade recommendations are Read-Only HITL.",
      };
      recordMcpRpcCall({
        method: "initialize",
        tool_name: null,
        status: "OK",
        latency_ms: performance.now() - startMs,
        auth_client: activeClient,
      });
      return NextResponse.json(
        { jsonrpc: "2.0", id: rpcId, result },
        { headers: corsHeaders({ "Mcp-Session-Id": sessionId }) }
      );
    }

    if (method === "notifications/initialized") {
      recordMcpRpcCall({
        method: "notifications/initialized",
        tool_name: null,
        status: "OK",
        latency_ms: performance.now() - startMs,
        auth_client: activeClient,
      });
      if (rpcId === null) {
        return new NextResponse(null, {
          status: 202,
          headers: corsHeaders({ "Mcp-Session-Id": sessionId }),
        });
      }
      return NextResponse.json(
        { jsonrpc: "2.0", id: rpcId, result: {} },
        { headers: corsHeaders({ "Mcp-Session-Id": sessionId }) }
      );
    }

    if (method === "ping") {
      recordMcpRpcCall({
        method: "ping",
        tool_name: null,
        status: "OK",
        latency_ms: performance.now() - startMs,
        auth_client: activeClient,
      });
      return NextResponse.json(
        { jsonrpc: "2.0", id: rpcId, result: {} },
        { headers: corsHeaders({ "Mcp-Session-Id": sessionId }) }
      );
    }

    if (method === "tools/list") {
      recordMcpRpcCall({
        method: "tools/list",
        tool_name: null,
        status: "OK",
        latency_ms: performance.now() - startMs,
        auth_client: activeClient,
      });
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: rpcId,
          result: {
            tools: MCP_TOOLS,
          },
        },
        { headers: corsHeaders({ "Mcp-Session-Id": sessionId }) }
      );
    }

    if (method === "resources/list") {
      recordMcpRpcCall({
        method: "resources/list",
        tool_name: null,
        status: "OK",
        latency_ms: performance.now() - startMs,
        auth_client: activeClient,
      });
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: rpcId,
          result: {
            resources: MCP_RESOURCES,
          },
        },
        { headers: corsHeaders({ "Mcp-Session-Id": sessionId }) }
      );
    }

    if (method === "resources/read") {
      const uri = String(params?.uri || "audit://idx-swrt/ledger/latest");
      let resourcePayload: any;
      if (uri === "audit://idx-swrt/oauth/status") {
        resourcePayload = getMcpOAuthState();
      } else {
        resourcePayload = loadAuditVaultMirror();
      }
      recordMcpRpcCall({
        method: "resources/read",
        tool_name: uri,
        status: "OK",
        latency_ms: performance.now() - startMs,
        auth_client: activeClient,
      });
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: rpcId,
          result: {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(resourcePayload, null, 2),
              },
            ],
          },
        },
        { headers: corsHeaders({ "Mcp-Session-Id": sessionId }) }
      );
    }

    if (method === "tools/call") {
      const toolName = String(params?.name || "");
      const args = params?.arguments || {};
      let toolOutput: any;

      if (toolName === "run_swrt_decision_pipeline") {
        const ticker = String(args.ticker || "BBCA")
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "");
        const regime = String(args.regime || "COHERENT_ACCUMULATION").toUpperCase();
        const capitalRp = Number(args.capital_rp || 100_000_000);

        const stdout = runPythonModule([
          "-m",
          "agents.agent_exe_unifier",
          "--ticker",
          ticker,
          "--regime",
          regime,
          "--capital",
          String(capitalRp),
        ]);
        toolOutput = JSON.parse(stdout);
      } else if (toolName === "verify_merkle_audit_chain") {
        const pyOut = runPythonModule([
          "-c",
          "import json; from services.merkle_audit_mcp.server import verify_merkle_chain, _sync_json_mirror; _sync_json_mirror('audit_vault'); print(json.dumps(verify_merkle_chain('audit_vault')))",
        ]);
        toolOutput = JSON.parse(pyOut);
      } else if (toolName === "get_latest_decision_cards") {
        const limit = Math.min(50, Math.max(1, Number(args.limit || 10)));
        const tickerFilter = args.ticker
          ? String(args.ticker).toUpperCase().trim()
          : null;
        const mirror = loadAuditVaultMirror();
        let receipts: any[] = Array.isArray(mirror?.receipts) ? mirror.receipts : [];
        if (tickerFilter) {
          receipts = receipts.filter(
            (r) => String(r?.ticker || "").toUpperCase() === tickerFilter
          );
        }
        toolOutput = {
          verification: mirror?.verification || null,
          count: Math.min(limit, receipts.length),
          receipts: receipts.slice(0, limit),
        };
      } else if (toolName === "compute_idx_tick_and_ara_arb") {
        const priceRp = Number(args.price_rp ?? 9750);
        const prevCloseRp = Number(args.prev_close_rp ?? priceRp);
        toolOutput = computeIdxTickAndAraArb(priceRp, prevCloseRp);
      } else {
        recordMcpRpcCall({
          method: "tools/call",
          tool_name: toolName,
          status: "ERROR",
          latency_ms: performance.now() - startMs,
          auth_client: activeClient,
        });
        return NextResponse.json(
          {
            jsonrpc: "2.0",
            id: rpcId,
            error: {
              code: -32601,
              message: `Unknown MCP tool: ${toolName}`,
            },
          },
          { status: 404, headers: corsHeaders({ "Mcp-Session-Id": sessionId }) }
        );
      }

      recordMcpRpcCall({
        method: "tools/call",
        tool_name: toolName,
        status: "OK",
        latency_ms: performance.now() - startMs,
        auth_client: activeClient,
      });

      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: rpcId,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(toolOutput, null, 2),
              },
            ],
            structuredContent: toolOutput,
            isError: false,
          },
        },
        { headers: corsHeaders({ "Mcp-Session-Id": sessionId }) }
      );
    }

    recordMcpRpcCall({
      method: method || "unknown",
      tool_name: null,
      status: "ERROR",
      latency_ms: performance.now() - startMs,
      auth_client: activeClient,
    });

    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: rpcId,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      },
      { status: 404, headers: corsHeaders({ "Mcp-Session-Id": sessionId }) }
    );
  } catch (err: any) {
    recordMcpRpcCall({
      method: method || "error",
      tool_name: params?.name || null,
      status: "ERROR",
      latency_ms: performance.now() - startMs,
      auth_client: activeClient,
    });
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: rpcId,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: err?.message || "MCP tool execution failed",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        },
      },
      { status: 200, headers: corsHeaders({ "Mcp-Session-Id": sessionId }) }
    );
  }
}
