import { clientIsAllowed, exchangeAuthorizationCode, mcpResourceUrl } from "@/server/mcp/oauth";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const grantType = String(form.get("grant_type") ?? "");
  const code = String(form.get("code") ?? "");
  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const resource = String(form.get("resource") ?? "");
  const codeVerifier = String(form.get("code_verifier") ?? "");

  if (grantType !== "authorization_code" || !(await clientIsAllowed(clientId)) || resource !== mcpResourceUrl()) {
    return Response.json({ error: "invalid_grant" }, { status: 400 });
  }
  const result = await exchangeAuthorizationCode({ code, clientId, redirectUri, resource, codeVerifier });
  if (!result) return Response.json({ error: "invalid_grant" }, { status: 400 });

  return Response.json({
    access_token: result.accessToken,
    token_type: "Bearer",
    expires_in: result.expiresIn,
    scope: result.scopes.join(" "),
  });
}
