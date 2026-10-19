import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, desc, eq, ilike } from "drizzle-orm";
import { ZodError, z } from "zod";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { recordMcpAction } from "@/server/mcp/audit";
import { getMcpPrincipal } from "@/server/mcp/context";
import {
  actionKindEnabled,
  hasMcpScope,
  protectedResourceMetadataUrl,
  type McpPrincipal,
} from "@/server/mcp/oauth";
import {
  availableActions,
  findAction,
  isActionAvailable,
  zodToInputSchema,
  type McpActionDefinition,
} from "@/server/mcp/registry";
import { queryCommercial } from "@/server/commercial/query";
import { registerAllActions } from "@/server/mcp/actions";
import { contactsCreateShape } from "@/server/mcp/actions/contacts";
import { emailSendShape } from "@/server/mcp/actions/email";
import { messagesSendShape } from "@/server/mcp/actions/messages";
import { quotesCreateShape, quotesSendShape } from "@/server/mcp/actions/quotes";
import { serializeContact } from "@/server/contacts";

const SERVER_NAME = "zorro-tech-crm";
const SERVER_VERSION = "1.3.0";

function authError(scope: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Authentication required for ${scope}.` }],
    _meta: {
      "mcp/www_authenticate": [
        `Bearer resource_metadata="${protectedResourceMetadataUrl()}", error="insufficient_scope", error_description="Authorize ${scope}"`,
      ],
    },
  };
}

function toolError(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

function principalFor(scope: string) {
  const principal = getMcpPrincipal();
  return principal && hasMcpScope(principal, scope) ? principal : null;
}

/** Solo el dueño de la organización puede ejecutar acciones no lectura. */
async function ownerPrincipal(principal: McpPrincipal | null): Promise<McpPrincipal | null> {
  if (!principal) return null;
  const [membership] = await getDb()
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, principal.organizationId),
        eq(schema.member.userId, principal.userId),
        eq(schema.member.role, "owner")
      )
    )
    .limit(1);
  return membership ? principal : null;
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    const issues = error.issues
      .map((issue) => `${issue.path.join(".") || "entrada"}: ${issue.message}`)
      .join("; ");
    return `Entrada inválida: ${issues}`;
  }
  if (error instanceof Error && error.message) return error.message;
  return "La acción falló.";
}

/**
 * Ejecuta una acción del registro y deja su trazabilidad en
 * `mcp_action_audit` (éxito o error). Es el único camino de escritura que
 * ve el LLM: nada queda sin registrar.
 */
async function executeAction(
  action: McpActionDefinition,
  principal: McpPrincipal,
  args: unknown
) {
  try {
    const result = await action.execute(principal, args ?? {});
    await recordMcpAction({
      principal,
      action: action.name,
      domain: action.domain,
      kind: action.kind,
      scope: action.scope,
      status: "ok",
      input: args,
      resultSummary: result.text,
    });
    return {
      ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
      content: [{ type: "text" as const, text: result.text }],
    };
  } catch (error) {
    const message = actionErrorMessage(error);
    await recordMcpAction({
      principal,
      action: action.name,
      domain: action.domain,
      kind: action.kind,
      scope: action.scope,
      status: "error",
      input: args,
      resultSummary: message,
    });
    return { isError: true, content: [{ type: "text" as const, text: message }] };
  }
}

/**
 * Camino de las herramientas nativas de escritura/borrado: mismo gate que
 * `actions_run` (tier + scope + dueño) y la misma auditoría.
 */
async function runNative(actionName: string, args: unknown) {
  const action = findAction(actionName);
  if (!action) return toolError(`Acción no disponible: ${actionName}`);
  const principal = getMcpPrincipal();
  if (!principal || !actionKindEnabled(action.kind) || !hasMcpScope(principal, action.scope)) {
    return authError(action.scope);
  }
  if (action.kind !== "read") {
    const owner = await ownerPrincipal(principal);
    if (!owner) return authError(action.scope);
  }
  return executeAction(action, principal, args);
}

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

/**
 * Creates a fresh MCP server for one Streamable HTTP session.
 * Session-local instances avoid sharing protocol state between clients.
 */
export function createMcpServer(): McpServer {
  // Registro idempotente: las acciones del dominio están disponibles aunque
  // la instancia del servidor se cree por cada petición sin sesión.
  registerAllActions();

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "This server exposes CRM tools. Use actions_list and actions_describe to discover the available CRM actions (contacts, pipeline, quotes, catalog, sending) and actions_run to execute them. Authentication is required for CRM data access; write, delete and send actions remain disabled unless explicitly enabled. Credential and integration secrets are never exposed or writable through this server.",
    }
  );

  server.registerTool(
    "health_check",
    {
      title: "Check CRM MCP connection",
      description:
        "Confirm that the Zorro Tech MCP server is reachable. This tool never reads or changes CRM data.",
      outputSchema: z.object({
        status: z.literal("ok"),
        readOnly: z.literal(true),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => ({
      structuredContent: { status: "ok", readOnly: true },
      content: [
        {
          type: "text",
          text: "Zorro Tech MCP is reachable. No CRM data was accessed.",
        },
      ],
    })
  );

  server.registerTool(
    "get_profile",
    {
      title: "Get connected CRM profile",
      description: "Return the user and organization represented by the current CRM connection.",
      outputSchema: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        organizationId: z.string(),
      }),
      annotations: readOnly,
      _meta: {
        "openai/profile": true,
        securitySchemes: [{ type: "oauth2", scopes: ["crm.profile.read"] }],
      },
    },
    async () => {
      const principal = principalFor("crm.profile.read");
      if (!principal) return authError("crm.profile.read");
      const [user] = await getDb()
        .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.id, principal.userId))
        .limit(1);
      if (!user) return { isError: true, content: [{ type: "text" as const, text: "Profile not found." }] };
      const profile = { ...user, organizationId: principal.organizationId };
      return { structuredContent: profile, content: [{ type: "text" as const, text: JSON.stringify(profile) }] };
    }
  );

  server.registerTool(
    "list_contacts",
    {
      title: "List CRM contacts",
      description: "List contacts belonging to the authenticated CRM organization. Read-only.",
      inputSchema: { query: z.string().trim().max(120).optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: readOnly,
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.contacts.read"] }] },
    },
    async ({ query, limit }) => {
      const principal = principalFor("crm.contacts.read");
      if (!principal) return authError("crm.contacts.read");
      const search = query ? `%${query.replace(/[\\%_]/g, "\\$&")}%` : null;
      const rows = await getDb()
        .select()
        .from(schema.contact)
        .where(
          scoped(
            schema.contact.organizationId,
            principal.organizationId,
            search ? ilike(schema.contact.name, search) : undefined
          )
        )
        .orderBy(desc(schema.contact.updatedAt))
        .limit(limit ?? 50);
      const contacts = rows.map((row) => serializeContact(row));
      return { structuredContent: { contacts }, content: [{ type: "text" as const, text: `Found ${contacts.length} contacts.` }] };
    }
  );

  server.registerTool(
    "get_contact",
    {
      title: "Get CRM contact",
      description: "Get one contact by ID from the authenticated CRM organization. Read-only.",
      inputSchema: { contactId: z.string().min(1).max(255) },
      annotations: readOnly,
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.contacts.read"] }] },
    },
    async ({ contactId }) => {
      const principal = principalFor("crm.contacts.read");
      if (!principal) return authError("crm.contacts.read");
      const [row] = await getDb()
        .select()
        .from(schema.contact)
        .where(scoped(schema.contact.organizationId, principal.organizationId, eq(schema.contact.id, contactId)))
        .limit(1);
      if (!row) return { isError: true, content: [{ type: "text" as const, text: "Contact not found." }] };
      return { structuredContent: { contact: serializeContact(row) }, content: [{ type: "text" as const, text: row.name }] };
    }
  );

  server.registerTool(
    "get_pipeline",
    {
      title: "Get CRM pipeline",
      description: "Return pipeline stages and lead cards for the authenticated CRM organization. Read-only.",
      annotations: readOnly,
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.pipeline.read"] }] },
    },
    async () => {
      const principal = principalFor("crm.pipeline.read");
      if (!principal) return authError("crm.pipeline.read");
      const db = getDb();
      const [stages, leads] = await Promise.all([
        db.select().from(schema.pipelineStage)
          .where(scoped(schema.pipelineStage.organizationId, principal.organizationId))
          .orderBy(asc(schema.pipelineStage.position)),
        db.select({ lead: schema.lead, contact: schema.contact })
          .from(schema.lead)
          .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
          .where(scoped(schema.lead.organizationId, principal.organizationId))
          .orderBy(asc(schema.lead.position)),
      ]);
      const result = {
        stages: stages.map((stage) => ({ id: stage.id, name: stage.name, position: stage.position, kind: stage.kind })),
        leads: leads.map(({ lead, contact }) => ({
          id: lead.id,
          stageId: lead.stageId,
          position: lead.position,
          amountCents: lead.amountCents,
          currency: lead.currency,
          priority: lead.priority,
          contact: { id: contact.id, name: contact.name, phone: contact.phone },
        })),
      };
      return { structuredContent: result, content: [{ type: "text" as const, text: `Found ${result.leads.length} pipeline leads.` }] };
    }
  );

  server.registerTool(
    "list_quotes",
    {
      title: "List CRM quotes",
      description: "List quotes belonging to the authenticated CRM organization. Read-only.",
      inputSchema: { status: z.string().trim().max(20).optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: readOnly,
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.quotes.read"] }] },
    },
    async ({ status, limit }) => {
      const principal = principalFor("crm.quotes.read");
      if (!principal) return authError("crm.quotes.read");
      const rows = await getDb().select().from(schema.quote)
        .where(scoped(schema.quote.organizationId, principal.organizationId, status ? eq(schema.quote.status, status) : undefined))
        .orderBy(desc(schema.quote.updatedAt)).limit(limit ?? 50);
      const quotes = rows.map((quote) => ({
        id: quote.id, quoteNumber: quote.quoteNumber, contactId: quote.contactId,
        status: quote.status, currency: quote.currency, subtotal: quote.subtotal,
        total: quote.total, validUntil: quote.validUntil?.toISOString() ?? null,
        createdAt: quote.createdAt.toISOString(), updatedAt: quote.updatedAt.toISOString(),
      }));
      return { structuredContent: { quotes }, content: [{ type: "text" as const, text: `Found ${quotes.length} quotes.` }] };
    }
  );

  server.registerTool(
    "list_catalog",
    {
      title: "List CRM catalog",
      description: "List available catalog products for the authenticated CRM organization. Read-only.",
      inputSchema: { query: z.string().trim().max(120).optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: readOnly,
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.catalog.read"] }] },
    },
    async ({ query, limit }) => {
      const principal = principalFor("crm.catalog.read");
      if (!principal) return authError("crm.catalog.read");
      const search = query ? `%${query.replace(/[\\%_]/g, "\\$&")}%` : null;
      const products = await getDb().select().from(schema.catalogProduct)
        .where(scoped(schema.catalogProduct.organizationId, principal.organizationId, search ? ilike(schema.catalogProduct.name, search) : undefined))
        .orderBy(asc(schema.catalogProduct.name)).limit(limit ?? 100);
      const result = products.map((product) => ({
        id: product.id, name: product.name, description: product.description,
        price: product.price, currency: product.currency, stock: product.stock,
        available: product.available, websiteUrl: product.websiteUrl,
      }));
      return { structuredContent: { products: result }, content: [{ type: "text" as const, text: `Found ${result.length} products.` }] };
    }
  );

  server.registerTool(
    "get_commercial_metrics",
    {
      title: "Get commercial metrics",
      description: "Read commercial metrics for the authenticated CRM organization. Read-only.",
      inputSchema: { period: z.enum(["7d", "30d", "90d", "1y"]).optional() },
      annotations: readOnly,
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.metrics.read"] }] },
    },
    async ({ period }) => {
      const principal = principalFor("crm.metrics.read");
      if (!principal) return authError("crm.metrics.read");
      const metrics = await queryCommercial(principal.organizationId, { period: period ?? "30d" });
      return { structuredContent: metrics, content: [{ type: "text" as const, text: `Commercial metrics for ${period ?? "30d"}.` }] };
    }
  );

  /* ---------------------------------------------------------------------
   * Meta-herramientas: descubrimiento y ejecución del registro de acciones.
   * Permiten "hacer de todo" con pocas herramientas nativas expuestas.
   * ------------------------------------------------------------------ */

  server.registerTool(
    "actions_list",
    {
      title: "List CRM actions",
      description:
        "Lista las acciones CRM disponibles para este token (crear, actualizar, eliminar, enviar...), con dominio y tipo. Solo lectura: para ejecutar usa actions_run.",
      inputSchema: {
        query: z.string().trim().max(120).optional(),
        domain: z.string().trim().max(40).optional(),
      },
      annotations: readOnly,
    },
    async ({ query, domain }) => {
      const principal = getMcpPrincipal();
      if (!principal) return authError("crm.profile.read");
      const needle = query?.trim().toLowerCase();
      const matches = availableActions(principal).filter((action) => {
        if (domain && action.domain !== domain) return false;
        if (!needle) return true;
        return [action.name, action.title, action.description].some((value) =>
          value.toLowerCase().includes(needle)
        );
      });
      const actions = matches.map((action) => ({
        name: action.name,
        domain: action.domain,
        kind: action.kind,
        title: action.title,
        destructive: Boolean(action.destructive),
      }));
      const text =
        actions.length > 0
          ? `${actions.length} acciones disponibles:\n${actions
              .map((action) => `- ${action.name} (${action.kind}): ${action.title}`)
              .join("\n")}`
          : "No hay acciones disponibles con esos filtros.";
      return {
        structuredContent: { count: actions.length, actions },
        content: [{ type: "text" as const, text }],
      };
    }
  );

  server.registerTool(
    "actions_describe",
    {
      title: "Describe a CRM action",
      description:
        "Devuelve la descripción y el esquema JSON de argumentos de una acción CRM antes de ejecutarla con actions_run.",
      inputSchema: { name: z.string().trim().min(1).max(128) },
      annotations: readOnly,
    },
    async ({ name }) => {
      const principal = getMcpPrincipal();
      if (!principal) return authError("crm.profile.read");
      const action = findAction(name);
      if (!action || !isActionAvailable(principal, action)) {
        return toolError(`Acción no disponible o no autorizada: ${name}`);
      }
      const payload = {
        name: action.name,
        domain: action.domain,
        kind: action.kind,
        scope: action.scope,
        title: action.title,
        description: action.description,
        destructive: Boolean(action.destructive),
        inputSchema: zodToInputSchema(action.inputSchema),
      };
      return {
        structuredContent: payload,
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      };
    }
  );

  server.registerTool(
    "actions_run",
    {
      title: "Run a CRM action",
      description:
        "Ejecuta una acción CRM (ver actions_list). Escrituras, borrados y envíos exigen el tier correspondiente habilitado, scope concedido y rol dueño; todo queda auditado. No existe acción para credenciales o integraciones.",
      inputSchema: {
        name: z.string().trim().min(1).max(128),
        args: z.record(z.unknown()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ name, args }) => {
      const principal = getMcpPrincipal();
      if (!principal) return authError("crm.profile.read");
      const action = findAction(name);
      if (!action || !isActionAvailable(principal, action)) {
        return toolError(`Acción no disponible o no autorizada: ${name}`);
      }
      if (action.kind !== "read") {
        const owner = await ownerPrincipal(principal);
        if (!owner) return authError(action.scope);
      }
      return executeAction(action, principal, args ?? {});
    }
  );

  if (actionKindEnabled("write")) {
    server.registerTool(
      "create_contact",
      {
        title: "Create CRM contact",
        description:
          "Create a contact with phone and its pipeline lead. Requires owner authorization and explicit confirmation.",
        inputSchema: contactsCreateShape,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.contacts.write"] }] },
      },
      async (args) => runNative("contacts.create", args)
    );

    server.registerTool(
      "update_contact",
      {
        title: "Update CRM contact",
        description: "Update an authenticated CRM contact. Requires owner authorization and explicit confirmation.",
        inputSchema: {
          contactId: z.string().min(1).max(255),
          name: z.string().trim().min(1).max(120).optional(),
          notes: z.string().max(4000).nullable().optional(),
          archived: z.boolean().optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.contacts.write"] }] },
      },
      async (args) => runNative("contacts.update", args)
    );

    server.registerTool(
      "create_quote",
      {
        title: "Create CRM quote",
        description:
          "Create a quote with line items (unit prices in cents) for a contact. Requires owner authorization and explicit confirmation.",
        inputSchema: quotesCreateShape,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.quotes.write"] }] },
      },
      async (args) => runNative("quotes.create", args)
    );

    server.registerTool(
      "move_lead",
      {
        title: "Move CRM lead",
        description: "Move a CRM lead to another pipeline stage. Requires owner authorization and explicit confirmation.",
        inputSchema: {
          leadId: z.string().min(1).max(255),
          stageId: z.string().min(1).max(255),
          lossReason: z.string().trim().max(120).optional(),
          lossNote: z.string().trim().max(4000).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.pipeline.write"] }] },
      },
      async (args) => runNative("pipeline.update_lead", args)
    );

    server.registerTool(
      "set_quote_status",
      {
        title: "Set quote status",
        description: "Accept or reject a CRM quote. Requires owner authorization and explicit confirmation.",
        inputSchema: {
          quoteId: z.string().min(1).max(255),
          status: z.enum(["accepted", "rejected"]),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.quotes.write"] }] },
      },
      async (args) => runNative("quotes.set_status", args)
    );
  }

  if (actionKindEnabled("delete")) {
    server.registerTool(
      "delete_contact",
      {
        title: "Delete CRM contact",
        description:
          "Permanently delete a CRM contact and its relationships. Requires owner authorization and explicit confirmation. Irreversible.",
        inputSchema: { contactId: z.string().min(1).max(255) },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.contacts.delete"] }] },
      },
      async (args) => runNative("contacts.delete", args)
    );
  }

  if (actionKindEnabled("send")) {
    server.registerTool(
      "send_message",
      {
        title: "Send message to a CRM chat",
        description:
          "Send a text message to a contact's conversation (WhatsApp, Instagram, Messenger...). Respects the reply window and never touches test conversations. Requires owner authorization and explicit confirmation.",
        inputSchema: messagesSendShape,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
        _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.messages.send"] }] },
      },
      async (args) => runNative("messages.send", args)
    );

    server.registerTool(
      "send_quote",
      {
        title: "Send CRM quote to a client",
        description:
          "Send a draft quote to the contact's chat by WhatsApp, Instagram or Messenger. Respects the reply window and never touches test conversations. Requires owner authorization and explicit confirmation.",
        inputSchema: quotesSendShape,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
        _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.quotes.send"] }] },
      },
      async (args) => runNative("quotes.send", args)
    );

    server.registerTool(
      "send_email",
      {
        title: "Send email from CRM account",
        description:
          "Send an email from a connected CRM mailbox (SMTP). Use email.accounts first to get the accountId. Requires owner authorization and explicit confirmation.",
        inputSchema: emailSendShape,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
        _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.email.send"] }] },
      },
      async (args) => runNative("email.send", args)
    );
  }

  if (actionKindEnabled("admin")) {
    server.registerTool(
      "list_audit",
      {
        title: "List CRM action audit log",
        description:
          "List the actions executed through MCP on this CRM (who, what action, domain, status, when). Filterable by action and result. Read-only; requires the admin tier enabled.",
        inputSchema: {
          action: z.string().trim().max(128).optional(),
          status: z.enum(["ok", "error"]).optional(),
          limit: z.number().int().min(1).max(200).optional(),
        },
        annotations: readOnly,
        _meta: { securitySchemes: [{ type: "oauth2", scopes: ["crm.audit.read"] }] },
      },
      async (args) => runNative("admin.audit_list", args)
    );
  }

  return server;
}
