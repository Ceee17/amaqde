import { NextRequest, NextResponse } from "next/server";
import {
  bindAuthorizationCodeToWebAi,
  exchangeAuthorizationCode,
  getMcpOAuthState,
  issueDirectAntigravityGrant,
  OAuthTokenRecord,
} from "@/lib/mcpOAuthStore";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

/**
 * RFC 6749 / OAuth 2.1 Token Endpoint
 * URL: /api/oauth/token
 */
export async function POST(req: NextRequest) {
  try {
    let body: Record<string, any> = {};
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      body = await req.json().catch(() => ({}));
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text().catch(() => "");
      const params = new URLSearchParams(text);
      body = Object.fromEntries(params.entries());
    } else {
      const text = await req.text().catch(() => "");
      if (text.trim().startsWith("{")) {
        try {
          body = JSON.parse(text);
        } catch {
          body = {};
        }
      } else {
        const params = new URLSearchParams(text);
        body = Object.fromEntries(params.entries());
      }
    }

    // Also check search parameters as fallback
    const { searchParams } = new URL(req.url);
    searchParams.forEach((v, k) => {
      if (body[k] === undefined || body[k] === "") {
        body[k] = v;
      }
    });

    const grantType = (body.grant_type || "").trim();
    const action = (body.action || "").trim();

    let tokenRecord: OAuthTokenRecord;

    // Direct Instant Grant issuance or binding an ag_authz_... code into the Web AI
    if (action === "bind_authz_code" || grantType === "bind_authz_code") {
      tokenRecord = bindAuthorizationCodeToWebAi(body.code || body.authz_code || "");
    } else if (action === "issue_direct_grant" || grantType === "issue_direct_grant" || grantType === "direct") {
      const result = issueDirectAntigravityGrant(body.client_name);
      tokenRecord = result.token;
    } else if (grantType === "client_credentials") {
      const clientId = body.client_id || "antigravity-ide-mcp-client";
      tokenRecord = exchangeAuthorizationCode({
        client_id: clientId,
        grant_type: "client_credentials",
        scope: body.scope,
      });
    } else if (grantType === "refresh_token") {
      const clientId = body.client_id || "antigravity-ide-mcp-client";
      tokenRecord = exchangeAuthorizationCode({
        client_id: clientId,
        grant_type: "client_credentials",
        scope: body.scope,
      });
    } else if (grantType === "authorization_code" || (!grantType && body.code)) {
      const code = (body.code || "").trim();
      const clientId = (body.client_id || "").trim() || undefined;
      const codeVerifier = (body.code_verifier || "").trim() || undefined;
      const redirectUri = (body.redirect_uri || "").trim() || undefined;

      if (!code) {
        return NextResponse.json(
          {
            error: "invalid_request",
            error_description: "Missing required parameter: code",
          },
          {
            status: 400,
            headers: CORS_HEADERS,
          }
        );
      }

      try {
        tokenRecord = exchangeAuthorizationCode({
          code,
          client_id: clientId,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        });
      } catch {
        // Fallback: if pasted directly from browser callback without PKCE verifier in web UI, bind directly
        tokenRecord = bindAuthorizationCodeToWebAi(code);
      }
    } else {
      return NextResponse.json(
        {
          error: "unsupported_grant_type",
          error_description: `Unsupported grant_type: '${grantType}'. Must be 'authorization_code' or 'client_credentials'.`,
        },
        {
          status: 400,
          headers: CORS_HEADERS,
        }
      );
    }

    const responsePayload = {
      access_token: tokenRecord.access_token,
      token_type: "Bearer" as const,
      expires_in: 86400,
      scope: tokenRecord.scope,
      refresh_token: `ag_refresh_${tokenRecord.token_sha256.slice(0, 16)}`,
      token_sha256: tokenRecord.token_sha256,
      bound_authz_code: tokenRecord.bound_authz_code || null,
      client_id: tokenRecord.client_id,
      client_name: tokenRecord.client_name,
    };

    return NextResponse.json(responsePayload, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    });
  } catch (err: any) {
    const errorMsg = err?.message || "Token exchange failed";
    const isInvalidGrant =
      errorMsg.includes("invalid_grant") ||
      errorMsg.includes("not found") ||
      errorMsg.includes("expired") ||
      errorMsg.includes("consumed") ||
      errorMsg.includes("PKCE");

    return NextResponse.json(
      {
        error: isInvalidGrant ? "invalid_grant" : "invalid_request",
        error_description: errorMsg,
      },
      {
        status: 400,
        headers: CORS_HEADERS,
      }
    );
  }
}

/**
 * Returns getMcpOAuthState() so the frontend UI can display live registered OAuth clients,
 * active Bearer tokens, and recent MCP JSON-RPC calls.
 */
export async function GET() {
  try {
    const state = getMcpOAuthState();
    return NextResponse.json(state, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "server_error",
        error_description: err?.message || "Failed to retrieve OAuth state",
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
