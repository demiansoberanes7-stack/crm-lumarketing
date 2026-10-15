import { oauthIssuer, supportedScopes } from "@/server/mcp/oauth";

export const dynamic = "force-dynamic";

export function GET(): Response {
  const issuer = oauthIssuer();
  return Response.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: supportedScopes(),
  });
}
