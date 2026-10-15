import {
  mcpDcrEnabled,
  registerClient,
  validateRegistrationRedirectUris,
} from "@/server/mcp/oauth";

export const dynamic = "force-dynamic";

type RegistrationBody = {
  client_name?: unknown;
  redirect_uris?: unknown;
};

/**
 * Dynamic Client Registration (RFC 7591). Cliente público (token_endpoint_auth_method
 * "none") coherente con el metadata del servidor de autorización. Apagado por
 * defecto: solo responde cuando MCP_DCR_ENABLED=true.
 */
export async function POST(request: Request): Promise<Response> {
  if (!mcpDcrEnabled()) {
    return Response.json(
      { error: "invalid_request", error_description: "Dynamic client registration is disabled" },
      { status: 404 }
    );
  }

  let body: RegistrationBody;
  try {
    body = (await request.json()) as RegistrationBody;
  } catch {
    return Response.json(
      { error: "invalid_client_metadata", error_description: "Body must be valid JSON" },
      { status: 400 }
    );
  }

  let redirectUris: string[];
  try {
    redirectUris = validateRegistrationRedirectUris(body.redirect_uris);
  } catch (error) {
    return Response.json(
      {
        error: "invalid_redirect_uri",
        error_description: error instanceof Error ? error.message : "Invalid redirect_uris",
      },
      { status: 400 }
    );
  }

  const clientName = typeof body.client_name === "string" ? body.client_name.slice(0, 255) : null;
  const client = await registerClient({ clientName, redirectUris });
  return Response.json(client, { status: 201 });
}
