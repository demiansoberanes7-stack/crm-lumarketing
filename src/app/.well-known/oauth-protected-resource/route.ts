import { mcpResourceUrl, oauthIssuer, supportedScopes } from "@/server/mcp/oauth";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({
    resource: mcpResourceUrl(),
    authorization_servers: [oauthIssuer()],
    scopes_supported: supportedScopes(),
  });
}
