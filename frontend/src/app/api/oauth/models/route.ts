import { NextRequest, NextResponse } from "next/server";
import {
  AgentId,
  bindAuthorizationCodeToWebAi,
  getMcpOAuthState,
  recordModelQuotaUsage,
  RoutingPresetId,
  updateMultiAgentRouting,
} from "@/lib/mcpOAuthStore";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

export async function GET() {
  try {
    const state = getMcpOAuthState();
    const activeToken = state.tokens?.[0] || null;
    const models = (state.model_catalog || []).map((m) => ({
      ...m,
      usage_pct:
        m.daily_request_limit > 0
          ? Number(((m.requests_used / m.daily_request_limit) * 100).toFixed(2))
          : 0,
    }));

    return NextResponse.json(
      {
        bound_oauth: {
          bound_authz_code:
            activeToken?.bound_authz_code ||
            state.bound_authz_code ||
            process.env.ANTIGRAVITY_OAUTH_CODE ||
            "ag_authz_example_user_session",
          client_id: activeToken?.client_id || "google-antigravity-dbb952c1",
          client_name:
            activeToken?.client_name || "Google Antigravity (Web AI + MCP Bridge)",
          token_sha256: activeToken?.token_sha256 || "",
          scopes: activeToken?.scopes || [
            "mcp:tools",
            "mcp:resources",
            "swrt:read_only_hitl",
            "merkle:verify",
          ],
          pkce_verified: true,
        },
        available_models: models,
        multi_agent_routing: state.multi_agent_routing,
        updated_at: state.updated_at,
      },
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to load OAuth models & routing state" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    if (body.authz_code && typeof body.authz_code === "string") {
      bindAuthorizationCodeToWebAi(body.authz_code);
    }

    if (body.record_usage_model_id) {
      recordModelQuotaUsage(
        body.record_usage_model_id,
        body.tokens_delta || 1100,
        body.requests_delta || 1
      );
    }

    const updatedRouting = updateMultiAgentRouting({
      active_preset: (body.preset || body.active_preset) as RoutingPresetId | undefined,
      selected_copilot_model: body.selected_copilot_model,
      oauth_bound_code: body.authz_code || body.oauth_bound_code,
      subagent_models: body.subagent_models,
      agent_models: body.agent_models as Partial<Record<AgentId, string>> | undefined,
    });

    const state = getMcpOAuthState();
    const activeToken = state.tokens?.[0] || null;
    const models = (state.model_catalog || []).map((m) => ({
      ...m,
      usage_pct:
        m.daily_request_limit > 0
          ? Number(((m.requests_used / m.daily_request_limit) * 100).toFixed(2))
          : 0,
    }));

    return NextResponse.json(
      {
        ok: true,
        bound_oauth: {
          bound_authz_code:
            activeToken?.bound_authz_code ||
            state.bound_authz_code ||
            process.env.ANTIGRAVITY_OAUTH_CODE ||
            "ag_authz_example_user_session",
          client_id: activeToken?.client_id || "google-antigravity-dbb952c1",
          client_name:
            activeToken?.client_name || "Google Antigravity (Web AI + MCP Bridge)",
          token_sha256: activeToken?.token_sha256 || "",
          scopes: activeToken?.scopes || [],
          pkce_verified: true,
        },
        available_models: models,
        multi_agent_routing: updatedRouting,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to update OAuth model routing" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
