import { NextRequest, NextResponse } from "next/server";
import { registerOAuthClient } from "@/lib/mcpOAuthStore";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

/**
 * RFC 7591 OAuth 2.0 Dynamic Client Registration endpoint
 * URL: /api/oauth/register
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
      // Attempt generic json parse
      const text = await req.text().catch(() => "");
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = {};
        }
      }
    }

    // Format redirect_uris array
    let redirectUris: string[] | undefined;
    if (Array.isArray(body.redirect_uris)) {
      redirectUris = body.redirect_uris.map(String);
    } else if (typeof body.redirect_uris === "string" && body.redirect_uris.trim()) {
      redirectUris = [body.redirect_uris.trim()];
    } else if (typeof body.redirect_uri === "string" && body.redirect_uri.trim()) {
      redirectUris = [body.redirect_uri.trim()];
    }

    let grantTypes: string[] | undefined;
    if (Array.isArray(body.grant_types)) {
      grantTypes = body.grant_types.map(String);
    }

    let responseTypes: string[] | undefined;
    if (Array.isArray(body.response_types)) {
      responseTypes = body.response_types.map(String);
    }

    const client = registerOAuthClient({
      client_name: typeof body.client_name === "string" ? body.client_name : undefined,
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: responseTypes,
      scope: typeof body.scope === "string" ? body.scope : undefined,
    });

    const issuedAt = Math.floor(new Date(client.created_at).getTime() / 1000);

    return NextResponse.json(
      {
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        grant_types: client.grant_types,
        response_types: client.response_types,
        scope: client.scope,
        token_endpoint_auth_method: "none",
        client_id_issued_at: issuedAt,
      },
      {
        status: 201,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description: err?.message || "Failed to register dynamic OAuth client",
      },
      {
        status: 400,
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
