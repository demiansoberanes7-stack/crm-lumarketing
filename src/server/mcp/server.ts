import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, desc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getMcpPrincipal } from "@/server/mcp/context";
import { hasMcpScope, protectedResourceMetadataUrl } from "@/server/mcp/oauth";
import { queryCommercial } from "@/server/commercial/query";
import { serializeContact } from "@/server/contacts";
import { moveLeadToStage } from "@/server/leads/stage-history";
import { changeQuoteStatus } from "@/server/quotes/service";

const SERVER_NAME = "lumark-crm";
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

function principalFor(scope: string) {
  const principal = getMcpPrincipal();
  return principal && hasMcpScope(principal, scope) ? principal : null;
}

async function ownerForWrite(scope: string) {
  if (process.env.MCP_WRITE_ENABLED !== "true") return null;
  const principal = principalFor(scope);
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
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "This server exposes read-only CRM tools. Authentication is required for CRM data access; write tools remain disabled unless explicitly enabled.",
    }
  );

  server.registerTool(
    "health_check",
    {
      title: "Check CRM MCP connection",
      description:
        "Confirm that the Lumark CRM MCP server is reachable. This tool never reads or changes CRM data.",
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
          text: "Lumark CRM MCP is reachable. No CRM data was accessed.",
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

  if (process.env.MCP_WRITE_ENABLED === "true") {
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
      async ({ contactId, name, notes, archived }) => {
        const principal = await ownerForWrite("crm.contacts.write");
        if (!principal) return authError("crm.contacts.write");
        if (name === undefined && notes === undefined && archived === undefined) {
          return { isError: true, content: [{ type: "text" as const, text: "At least one field is required." }] };
        }
        const [contact] = await getDb()
          .update(schema.contact)
          .set({
            ...(name !== undefined ? { name } : {}),
            ...(notes !== undefined ? { notes } : {}),
            ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
            updatedAt: new Date(),
          })
          .where(scoped(schema.contact.organizationId, principal.organizationId, eq(schema.contact.id, contactId)))
          .returning();
        if (!contact) return { isError: true, content: [{ type: "text" as const, text: "Contact not found." }] };
        return {
          structuredContent: { contact: serializeContact(contact) },
          content: [{ type: "text" as const, text: `Updated contact ${contact.name}.` }],
        };
      }
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
      async ({ leadId, stageId, lossReason, lossNote }) => {
        const principal = await ownerForWrite("crm.pipeline.write");
        if (!principal) return authError("crm.pipeline.write");
        const result = await moveLeadToStage({
          organizationId: principal.organizationId,
          leadId,
          toStageId: stageId,
          actorUserId: principal.userId,
          source: "dueno",
          lossReason: (lossReason as never) ?? null,
          lossNote: lossNote ?? null,
        });
        if (!result.ok) return { isError: true, content: [{ type: "text" as const, text: result.reason }] };
        return {
          structuredContent: { leadId: result.lead.id, stageId: result.lead.stageId, changed: result.changed },
          content: [{ type: "text" as const, text: result.changed ? "Lead moved." : "Lead was already in that stage." }],
        };
      }
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
      async ({ quoteId, status }) => {
        const principal = await ownerForWrite("crm.quotes.write");
        if (!principal) return authError("crm.quotes.write");
        try {
          await changeQuoteStatus(principal.organizationId, quoteId, status);
        } catch {
          return { isError: true, content: [{ type: "text" as const, text: "Quote status change failed." }] };
        }
        return { structuredContent: { quoteId, status }, content: [{ type: "text" as const, text: `Quote marked ${status}.` }] };
      }
    );
  }

  return server;
}
