import { mcpDcrEnabled, oauthIssuer, supportedScopes } from "@/server/mcp/oauth";

export const dynamic = "force-dynamic";

export function GET(): Response {
  const issuer = oauthIssuer();
  const metadata: Record<string, unknown> = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    scopes_supported: supportedScopes(),
  };
  if (mcpDcrEnabled()) {
    metadata.registration_endpoint = `${issuer}/register`;
  }
  return Response.json(metadata);
}
