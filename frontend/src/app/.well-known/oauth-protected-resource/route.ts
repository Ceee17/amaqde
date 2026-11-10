import { NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

/**
 * RFC 9728 OAuth 2.0 Protected Resource Metadata endpoint
 * URL: /.well-known/oauth-protected-resource
 */
export async function GET() {
  const metadata = {
    resource: "http://localhost:3000/api/mcp",
    authorization_servers: ["http://localhost:3000"],
    bearer_methods_supported: ["header"],
    scopes_supported: [
      "mcp:tools",
      "mcp:resources",
      "swrt:read_only_hitl",
      "merkle:verify",
    ],
    resource_name: "IDX SWRT Quantitative Decision Engine MCP",
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
