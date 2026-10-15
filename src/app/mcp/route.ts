import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/server/mcp/server";
import { withMcpPrincipal } from "@/server/mcp/context";
import { resolveMcpBearerToken, unauthorizedChallengeResponse } from "@/server/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type McpSession = {
  server: ReturnType<typeof createMcpServer>;
  transport: WebStandardStreamableHTTPServerTransport;
};

const sessions = new Map<string, McpSession>();

function jsonError(message: string, status: number): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message } },
    { status }
  );
}

async function handleMcpRequest(request: Request): Promise<Response> {
  const principal = await resolveMcpBearerToken(request);
  if (!principal) return unauthorizedChallengeResponse();
  const sessionId = request.headers.get("mcp-session-id");

  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return jsonError("MCP session not found", 404);

    const response = await withMcpPrincipal(principal, () =>
      session.transport.handleRequest(request)
    );
    if (request.method === "DELETE") sessions.delete(sessionId);
    return response;
  }

  if (request.method !== "POST") {
    return jsonError("MCP initialization requires POST", 400);
  }

  const server = createMcpServer();
  let initializedSessionId: string | undefined;
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
    onsessioninitialized: (newSessionId) => {
      initializedSessionId = newSessionId;
      sessions.set(newSessionId, { server, transport });
    },
  });

  transport.onclose = () => {
    if (initializedSessionId) sessions.delete(initializedSessionId);
  };

  await server.connect(transport);
  return withMcpPrincipal(principal, () => transport.handleRequest(request));
}

export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}
