import { NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

/**
 * RFC 8414 OAuth 2.0 / 2.1 Authorization Server Metadata endpoint
 * URL: /.well-known/oauth-authorization-server
 */
export async function GET() {
  const metadata = {
    issuer: "http://localhost:3000",
    authorization_endpoint: "http://localhost:3000/api/oauth/authorize",
    token_endpoint: "http://localhost:3000/api/oauth/token",
    registration_endpoint: "http://localhost:3000/api/oauth/register",
    scopes_supported: [
      "mcp:tools",
      "mcp:resources",
      "swrt:read_only_hitl",
      "merkle:verify",
    ],
    response_types_supported: ["code"],
    grant_types_supported: [
      "authorization_code",
      "client_credentials",
      "refresh_token",
    ],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    code_challenge_methods_supported: ["S256", "plain"],
    service_documentation: "http://localhost:3000/api/mcp",
  };

  return NextResponse.json(metadata, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
