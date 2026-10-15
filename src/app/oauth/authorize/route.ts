import { getAuth } from "@/lib/auth";
import { resolveMembership } from "@/server/auth/on-signup";
import {
  createAuthorizationCode,
  isAllowedClient,
  isAllowedRedirectUri,
  mcpResourceUrl,
  normalizeScopes,
  oauthErrorRedirect,
} from "@/server/mcp/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const resource = url.searchParams.get("resource") ?? "";

  if (!isAllowedClient(clientId) || !isAllowedRedirectUri(redirectUri)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (url.searchParams.get("response_type") !== "code") {
    return oauthErrorRedirect(redirectUri, "unsupported_response_type", "Only authorization code is supported", state);
  }
  if (url.searchParams.get("code_challenge_method") !== "S256" || !codeChallenge) {
    return oauthErrorRedirect(redirectUri, "invalid_request", "PKCE S256 is required", state);
  }
  if (resource !== mcpResourceUrl()) {
    return oauthErrorRedirect(redirectUri, "invalid_target", "The resource does not match this MCP server", state);
  }

  let scopes: string[];
  try {
    scopes = normalizeScopes(url.searchParams.get("scope"));
  } catch (error) {
    return oauthErrorRedirect(redirectUri, "invalid_scope", error instanceof Error ? error.message : "Invalid scope", state);
  }

  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) {
    const login = new URL("/login", request.url);
    login.searchParams.set("callbackURL", request.url);
    return Response.redirect(login);
  }
  const membership = await resolveMembership(session.user.id);
  if (!membership) {
    return oauthErrorRedirect(redirectUri, "access_denied", "The user has no organization", state);
  }

  const code = await createAuthorizationCode({
    clientId,
    redirectUri,
    resource,
    codeChallenge,
    userId: session.user.id,
    organizationId: membership.organizationId,
    scopes,
  });
  const callback = new URL(redirectUri);
  callback.searchParams.set("code", code);
  if (state) callback.searchParams.set("state", state);
  return Response.redirect(callback);
}
