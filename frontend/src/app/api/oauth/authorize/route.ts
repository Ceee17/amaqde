import { NextRequest, NextResponse } from "next/server";
import { createAuthorizationCode } from "@/lib/mcpOAuthStore";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

const DEFAULT_SCOPES = "mcp:tools mcp:resources swrt:read_only_hitl merkle:verify";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildRedirectUrl(baseUri: string, code: string, state?: string): string {
  const separator = baseUri.includes("?") ? "&" : "?";
  let url = `${baseUri}${separator}code=${encodeURIComponent(code)}`;
  if (state) {
    url += `&state=${encodeURIComponent(state)}`;
  }
  return url;
}

function buildErrorRedirectUrl(baseUri: string, error: string, state?: string): string {
  const separator = baseUri.includes("?") ? "&" : "?";
  let url = `${baseUri}${separator}error=${encodeURIComponent(error)}`;
  if (state) {
    url += `&state=${encodeURIComponent(state)}`;
  }
  return url;
}

function renderConsentHtml(params: {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}): string {
  const {
    clientId,
    redirectUri,
    responseType,
    scope,
    state,
    codeChallenge,
    codeChallengeMethod,
  } = params;

  const scopesList = scope.split(/\s+/).filter(Boolean);
  const cancelUrl = buildErrorRedirectUrl(redirectUri, "access_denied", state);

  const scopeCards = scopesList.map((s) => {
    let title = s;
    let description = "Access permitted within the IDX SWRT runtime.";
    let badgeColor = "bg-emerald-950/80 text-emerald-400 border-emerald-800/60";

    if (s === "mcp:tools") {
      title = "mcp:tools";
      description = "Execute deterministic SWRT Decision Pipeline, Rough Path signatures, and tick math.";
      badgeColor = "bg-cyan-950/80 text-cyan-400 border-cyan-800/60";
    } else if (s === "swrt:read_only_hitl") {
      title = "swrt:read_only_hitl";
      description = "Strict Read-Only Human-in-the-Loop constraint. Never executes automatic orders.";
      badgeColor = "bg-emerald-950/80 text-emerald-400 border-emerald-800/60";
    } else if (s === "merkle:verify") {
      title = "merkle:verify";
      description = "Inspect and verify SHA-256 Merkle receipts and frozen Parquet snapshots.";
      badgeColor = "bg-purple-950/80 text-purple-400 border-purple-800/60";
    } else if (s === "mcp:resources") {
      title = "mcp:resources";
      description = "Read audit ledger and OAuth state URIs (audit://idx-swrt/...).";
      badgeColor = "bg-blue-950/80 text-blue-400 border-blue-800/60";
    }

    return `
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(51, 65, 85, 0.5); border-radius: 8px; padding: 12px 14px; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
          <code style="font-family: monospace; font-size: 13px; font-weight: 600; color: #38bdf8;">${escapeHtml(title)}</code>
          <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 9999px; border: 1px solid rgba(16, 185, 129, 0.4); color: #34d399; background: rgba(6, 78, 59, 0.4);">Verified</span>
        </div>
        <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.4;">${escapeHtml(description)}</p>
      </div>
    `;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize Antigravity MCP — IDX SWRT Engine</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background-color: #030712;
      background-image: 
        radial-gradient(at 0% 0%, rgba(16, 185, 129, 0.12) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(56, 189, 248, 0.1) 0px, transparent 50%);
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 540px;
      background: #0b0f19;
      border: 1px solid rgba(51, 65, 85, 0.6);
      border-radius: 16px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px -10px rgba(16, 185, 129, 0.15);
      overflow: hidden;
    }
    .header {
      padding: 24px 28px 20px;
      border-bottom: 1px solid rgba(30, 41, 59, 0.8);
      background: linear-gradient(180deg, rgba(15, 23, 42, 0.9) 0%, rgba(11, 15, 25, 0.9) 100%);
    }
    .badge-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.01em;
    }
    .subtitle {
      margin: 0;
      font-size: 13px;
      color: #94a3b8;
      line-height: 1.4;
    }
    .body-content {
      padding: 24px 28px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid rgba(51, 65, 85, 0.4);
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 20px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
    }
    .meta-label {
      color: #64748b;
      font-weight: 500;
    }
    .meta-value {
      color: #e2e8f0;
      font-family: monospace;
      font-weight: 600;
      word-break: break-all;
      text-align: right;
      max-width: 65%;
    }
    .section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      margin-bottom: 10px;
    }
    .notice {
      background: rgba(16, 185, 129, 0.05);
      border-left: 3px solid #10b981;
      padding: 10px 14px;
      border-radius: 4px;
      font-size: 12px;
      color: #a7f3d0;
      line-height: 1.4;
      margin-bottom: 24px;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .btn-submit {
      width: 100%;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: #ffffff;
      border: 1px solid rgba(52, 211, 153, 0.4);
      padding: 13px 20px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
    }
    .btn-submit:hover {
      background: linear-gradient(135deg, #34d399 0%, #10b981 100%);
      box-shadow: 0 6px 16px rgba(16, 185, 129, 0.45);
      transform: translateY(-1px);
    }
    .btn-cancel {
      display: block;
      text-align: center;
      padding: 10px;
      font-size: 13px;
      color: #64748b;
      text-decoration: none;
      transition: color 0.15s ease;
    }
    .btn-cancel:hover {
      color: #ef4444;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="badge-pill">
        <span class="dot"></span>
        OAuth 2.1 + PKCE S256 Handshake
      </div>
      <h1>Authorize Antigravity MCP Access</h1>
      <p class="subtitle">Grant Google Antigravity IDE read-only mathematical quant integration with the IDX SWRT Engine.</p>
    </div>

    <div class="body-content">
      <div class="meta-grid">
        <div class="meta-row">
          <span class="meta-label">Client ID</span>
          <span class="meta-value">${escapeHtml(clientId)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Redirect Target</span>
          <span class="meta-value">${escapeHtml(redirectUri)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">PKCE Challenge</span>
          <span class="meta-value">${codeChallenge ? escapeHtml(codeChallengeMethod || "S256") + " Verified" : "Not Provided"}</span>
        </div>
      </div>

      <div class="section-title">Requested Permissions & Scopes</div>
      ${scopeCards}

      <div class="notice">
        <strong>Rule 4 Enforced:</strong> All decisions are verified via SHA-256 Merkle chain. Execution is 100% Read-Only Human-in-the-Loop; no real broker orders can be placed.
      </div>

      <div class="actions">
        <form method="GET" action="/api/oauth/authorize">
          <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
          <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
          <input type="hidden" name="response_type" value="${escapeHtml(responseType)}">
          <input type="hidden" name="scope" value="${escapeHtml(scope)}">
          <input type="hidden" name="state" value="${escapeHtml(state)}">
          <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
          <input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}">
          <input type="hidden" name="auto_approve" value="1">
          <button type="submit" class="btn-submit">Authorize Antigravity MCP Access</button>
        </form>
        <a href="${escapeHtml(cancelUrl)}" class="btn-cancel">Deny &amp; Cancel</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * OAuth 2.1 Authorization Endpoint
 * URL: /api/oauth/authorize
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const clientId = searchParams.get("client_id") || "antigravity-ide-mcp-client";
    const redirectUri = searchParams.get("redirect_uri") || "http://localhost:3000/api/oauth/callback";
    const responseType = searchParams.get("response_type") || "code";
    const scope = searchParams.get("scope") || DEFAULT_SCOPES;
    const state = searchParams.get("state") || "";
    const codeChallenge = searchParams.get("code_challenge") || "";
    const codeChallengeMethod = searchParams.get("code_challenge_method") || (codeChallenge ? "S256" : "");
    const autoApprove = searchParams.get("auto_approve");
    const format = searchParams.get("format");

    const acceptHeader = req.headers.get("accept") || "";
    const isJsonRequested =
      format === "json" ||
      acceptHeader.includes("application/json") ||
      acceptHeader.includes("application/vnd.mcp+json");

    const isAutoApproved =
      autoApprove === "1" ||
      autoApprove === "true" ||
      autoApprove === "yes";

    // If auto_approve or JSON API client, issue authorization code immediately
    if (isAutoApproved || isJsonRequested) {
      const authCode = createAuthorizationCode({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        code_challenge: codeChallenge || undefined,
        code_challenge_method: codeChallengeMethod || undefined,
        state: state || undefined,
      });

      const redirectUrl = buildRedirectUrl(authCode.redirect_uri, authCode.code, authCode.state);

      if (isJsonRequested) {
        return NextResponse.json(
          {
            code: authCode.code,
            state: authCode.state || null,
            redirect_uri: authCode.redirect_uri,
            redirect_url: redirectUrl,
          },
          {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
            },
          }
        );
      }

      // HTTP 302 Redirect
      try {
        return NextResponse.redirect(redirectUrl, 302);
      } catch {
        return new NextResponse(null, {
          status: 302,
          headers: {
            Location: redirectUrl,
            ...CORS_HEADERS,
          },
        });
      }
    }

    // Otherwise render the dark-mode OAuth 2.1 Consent Page
    const html = renderConsentHtml({
      clientId,
      redirectUri,
      responseType,
      scope,
      state,
      codeChallenge,
      codeChallengeMethod,
    });

    return new NextResponse(html, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "server_error",
        error_description: err?.message || "Failed to process authorization request",
      },
      {
        status: 500,
        headers: CORS_HEADERS,
      }
    );
  }
}

/**
 * Handle direct form approval or JSON authorization requests
 */
export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      body = await req.json().catch(() => ({}));
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData().catch(() => null);
      if (formData) {
        body = Object.fromEntries(formData.entries());
      }
    } else {
      const text = await req.text().catch(() => "");
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = {};
        }
      }
    }

    const clientId = body.client_id || "antigravity-ide-mcp-client";
    const redirectUri = body.redirect_uri || "http://localhost:3000/api/oauth/callback";
    const scope = body.scope || DEFAULT_SCOPES;
    const state = body.state || "";
    const codeChallenge = body.code_challenge || "";
    const codeChallengeMethod = body.code_challenge_method || (codeChallenge ? "S256" : "");

    const authCode = createAuthorizationCode({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      code_challenge: codeChallenge || undefined,
      code_challenge_method: codeChallengeMethod || undefined,
      state: state || undefined,
    });

    const redirectUrl = buildRedirectUrl(authCode.redirect_uri, authCode.code, authCode.state);

    const acceptHeader = req.headers.get("accept") || "";
    if (contentType.includes("application/json") || acceptHeader.includes("application/json")) {
      return NextResponse.json(
        {
          code: authCode.code,
          state: authCode.state || null,
          redirect_uri: authCode.redirect_uri,
          redirect_url: redirectUrl,
        },
        {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
          },
        }
      );
    }

    try {
      return NextResponse.redirect(redirectUrl, 302);
    } catch {
      return new NextResponse(null, {
        status: 302,
        headers: {
          Location: redirectUrl,
          ...CORS_HEADERS,
        },
      });
    }
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "server_error",
        error_description: err?.message || "Failed to issue authorization code",
      },
      {
        status: 500,
        headers: CORS_HEADERS,
      }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
