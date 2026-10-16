import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/server/mcp/server";
import { withMcpPrincipal } from "@/server/mcp/context";
import { resolveMcpBearerToken, unauthorizedChallengeResponse } from "@/server/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Modo stateless (Streamable HTTP sin sessionIdGenerator): cada petición POST
 * crea su propio server+transport y no se guarda nada en memoria. Así un
 * reinicio no deja sesiones huérfanas, la conexión sobrevive a un deploy y
 * el estado vivo queda únicamente en Postgres (OAuth, auditoría, dominio).
 */
async function handleMcpPost(request: Request): Promise<Response> {
  const principal = await resolveMcpBearerToken(request);
  if (!principal) return unauthorizedChallengeResponse();

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return withMcpPrincipal(principal, () => transport.handleRequest(request));
}

function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" } }), {
    status: 405,
    headers: { "content-type": "application/json", allow: "POST" },
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleMcpPost(request);
}

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}
