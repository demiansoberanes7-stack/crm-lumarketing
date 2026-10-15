import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { mcpAccessToken, mcpAuthorizationCode, mcpOauthClient } from "@/lib/db/schema";

export const MCP_READ_SCOPES = [
  "crm.profile.read",
  "crm.contacts.read",
  "crm.pipeline.read",
  "crm.quotes.read",
  "crm.catalog.read",
  "crm.metrics.read",
] as const;

export const MCP_WRITE_SCOPES = [
  "crm.contacts.write",
  "crm.pipeline.write",
  "crm.quotes.write",
] as const;

export type McpReadScope = (typeof MCP_READ_SCOPES)[number];

export type McpPrincipal = {
  userId: string;
  organizationId: string;
  scopes: Set<string>;
  clientId: string;
};

function baseUrl(): string {
  const value = process.env.MCP_AUTH_BASE_URL?.trim() || process.env.APP_BASE_URL;
  if (!value) throw new Error("MCP_AUTH_BASE_URL or APP_BASE_URL is required");
  return new URL(value).toString().replace(/\/$/, "");
}

export function mcpResourceUrl(): string {
  const value = process.env.MCP_RESOURCE_URL;
  if (value) return new URL(value).toString().replace(/\/$/, "");
  return `${baseUrl()}/mcp`;
}

export function oauthIssuer(): string {
  const value = process.env.MCP_OAUTH_ISSUER;
  if (value) return new URL(value).toString().replace(/\/$/, "");
  return `${baseUrl()}/oauth`;
}

export function protectedResourceMetadataUrl(): string {
  return `${baseUrl()}/.well-known/oauth-protected-resource`;
}

export function mcpDcrEnabled(): boolean {
  return process.env.MCP_DCR_ENABLED === "true";
}

/**
 * Reto OAuth 2.1 para peticiones MCP sin token (RFC 9728 + MCP 2025-06-18).
 * ChatGPT usa este 401/WWW-Authenticate para disparar el flujo de autorización.
 */
export function unauthorizedChallengeResponse(): Response {
  return new Response(null, {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer resource_metadata="${protectedResourceMetadataUrl()}"`,
    },
  });
}

export function supportedScopes(): string[] {
  return process.env.MCP_WRITE_ENABLED === "true"
    ? [...MCP_READ_SCOPES, ...MCP_WRITE_SCOPES]
    : [...MCP_READ_SCOPES];
}

export function normalizeScopes(scope: string | null | undefined): string[] {
  const requested = (scope ?? "")
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const unique = [...new Set(requested)];
  const allowed = supportedScopes();
  const invalid = unique.filter((value) => !allowed.includes(value));
  if (invalid.length > 0) throw new Error(`Unsupported MCP scope: ${invalid.join(", ")}`);
  return unique.length > 0 ? unique : [...MCP_READ_SCOPES];
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function isAllowedClient(clientId: string): boolean {
  const configured = (process.env.MCP_ALLOWED_CLIENT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes(clientId)) return true;
  return clientId === "https://chatgpt.com/oauth/client.json" ||
    clientId.startsWith("https://chatgpt.com/oauth/");
}

export function isAllowedRedirectUri(redirectUri: string): boolean {
  const configured = (process.env.MCP_ALLOWED_REDIRECT_URIS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes(redirectUri)) return true;
  try {
    const url = new URL(redirectUri);
    return url.protocol === "https:" &&
      url.hostname === "chatgpt.com" &&
      (url.pathname === "/connector_platform_oauth_redirect" ||
        url.pathname.startsWith("/connector/oauth/"));
  } catch {
    return false;
  }
}

function dcrAllowedHosts(): string[] {
  const configured = (process.env.MCP_DCR_ALLOWED_HOSTS ?? "chatgpt.com")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? configured : ["chatgpt.com"];
}

function isDcrRedirectUriAllowed(redirectUri: string): boolean {
  if (isAllowedRedirectUri(redirectUri)) return true;
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return dcrAllowedHosts().some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`)
    );
  } catch {
    return false;
  }
}

export function validateRegistrationRedirectUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("redirect_uris must be a non-empty array");
  }
  const uris = value.map((uri) => {
    if (typeof uri !== "string") throw new Error("redirect_uris must contain strings");
    if (!isDcrRedirectUriAllowed(uri)) throw new Error(`redirect_uri not allowed: ${uri}`);
    return uri;
  });
  return [...new Set(uris)];
}

async function findRegisteredClient(clientId: string) {
  const [row] = await getDb()
    .select({ redirectUris: mcpOauthClient.redirectUris })
    .from(mcpOauthClient)
    .where(eq(mcpOauthClient.clientId, clientId))
    .limit(1);
  return row ?? null;
}

export type RegisteredClient = {
  client_id: string;
  client_id_issued_at: number;
  client_name?: string;
  redirect_uris: string[];
  token_endpoint_auth_method: "none";
  grant_types: string[];
  response_types: string[];
};

export async function registerClient(input: {
  clientName?: string | null;
  redirectUris: string[];
}): Promise<RegisteredClient> {
  const clientId = newId("mcpClient");
  await getDb().insert(mcpOauthClient).values({
    id: clientId,
    clientId,
    clientName: input.clientName ?? null,
    redirectUris: input.redirectUris.join(" "),
  });
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(input.clientName ? { client_name: input.clientName } : {}),
    redirect_uris: input.redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
  };
}

/**
 * Cliente permitido por CIMD/patrón ChatGPT o por registro dinámico (DCR).
 */
export async function clientIsAllowed(clientId: string): Promise<boolean> {
  if (isAllowedClient(clientId)) return true;
  if (!mcpDcrEnabled()) return false;
  return (await findRegisteredClient(clientId)) !== null;
}

/**
 * La URI de redirección debe pertenecer al cliente (si fue registrado por DCR)
 * o cumplir el patrón ChatGPT.
 */
export async function redirectUriIsAllowed(
  clientId: string,
  redirectUri: string
): Promise<boolean> {
  if (isAllowedRedirectUri(redirectUri)) return true;
  if (!mcpDcrEnabled()) return false;
  const client = await findRegisteredClient(clientId);
  if (!client) return false;
  return client.redirectUris.split(" ").filter(Boolean).includes(redirectUri);
}

export async function createAuthorizationCode(input: {
  clientId: string;
  redirectUri: string;
  resource: string;
  codeChallenge: string;
  userId: string;
  organizationId: string;
  scopes: string[];
}): Promise<string> {
  const code = randomSecret();
  await getDb().insert(mcpAuthorizationCode).values({
    id: newId("mcpCode"),
    codeHash: hash(code),
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    resource: input.resource,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: "S256",
    scopes: input.scopes.join(" "),
    userId: input.userId,
    organizationId: input.organizationId,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  return code;
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  codeVerifier: string;
}): Promise<{ accessToken: string; expiresIn: number; scopes: string[] } | null> {
  const db = getDb();
  const now = new Date();
  const [code] = await db
    .select()
    .from(mcpAuthorizationCode)
    .where(
      and(
        eq(mcpAuthorizationCode.codeHash, hash(input.code)),
        eq(mcpAuthorizationCode.clientId, input.clientId),
        eq(mcpAuthorizationCode.redirectUri, input.redirectUri),
        eq(mcpAuthorizationCode.resource, input.resource),
        isNull(mcpAuthorizationCode.usedAt),
        gt(mcpAuthorizationCode.expiresAt, now)
      )
    )
    .limit(1);
  if (!code || code.codeChallengeMethod !== "S256") return null;

  const verifierChallenge = createHash("sha256")
    .update(input.codeVerifier)
    .digest("base64url");
  if (verifierChallenge !== code.codeChallenge) return null;

  const [claimed] = await db
    .update(mcpAuthorizationCode)
    .set({ usedAt: now })
    .where(
      and(
        eq(mcpAuthorizationCode.id, code.id),
        isNull(mcpAuthorizationCode.usedAt)
      )
    )
    .returning({ id: mcpAuthorizationCode.id });
  if (!claimed) return null;

  const accessToken = randomSecret();
  const expiresIn = 60 * 60;
  await db.insert(mcpAccessToken).values({
    id: newId("mcpToken"),
    tokenHash: hash(accessToken),
    clientId: code.clientId,
    resource: code.resource,
    scopes: code.scopes,
    userId: code.userId,
    organizationId: code.organizationId,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  });

  return {
    accessToken,
    expiresIn,
    scopes: code.scopes.split(" ").filter(Boolean),
  };
}

export async function resolveMcpBearerToken(
  request: Request
): Promise<McpPrincipal | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return null;

  const [row] = await getDb()
    .select({
      userId: mcpAccessToken.userId,
      organizationId: mcpAccessToken.organizationId,
      scopes: mcpAccessToken.scopes,
      clientId: mcpAccessToken.clientId,
    })
    .from(mcpAccessToken)
    .where(
      and(
        eq(mcpAccessToken.tokenHash, hash(token)),
        isNull(mcpAccessToken.revokedAt),
        gt(mcpAccessToken.expiresAt, new Date())
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    userId: row.userId,
    organizationId: row.organizationId,
    clientId: row.clientId,
    scopes: new Set(row.scopes.split(" ").filter(Boolean)),
  };
}

export function hasMcpScope(principal: McpPrincipal, scope: string): boolean {
  return principal.scopes.has(scope);
}

export function oauthErrorRedirect(
  redirectUri: string,
  error: string,
  description: string,
  state: string | null
): Response {
  const target = new URL(redirectUri);
  target.searchParams.set("error", error);
  target.searchParams.set("error_description", description);
  if (state) target.searchParams.set("state", state);
  return Response.redirect(target);
}
