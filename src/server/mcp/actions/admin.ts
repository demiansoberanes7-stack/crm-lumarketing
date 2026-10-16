import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { defineAction } from "@/server/mcp/registry";

const auditList = z.object({
  action: z.string().trim().max(128).optional(),
  status: z.enum(["ok", "error"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const adminActions = [
  defineAction({
    name: "admin.audit_list",
    domain: "admin",
    kind: "admin",
    scope: "crm.audit.read",
    title: "Consultar bitácora MCP",
    description:
      "Lista las acciones MCP ejecutadas con este CRM (quién, qué acción, dominio, estado y cuándo). Filtrable por acción y resultado. Solo lectura del registro de auditoría; requiere el tier admin habilitado.",
    input: auditList,
    handler: async (principal, input) => {
      const rows = await getDb()
        .select({
          id: schema.mcpActionAudit.id,
          action: schema.mcpActionAudit.action,
          domain: schema.mcpActionAudit.domain,
          kind: schema.mcpActionAudit.kind,
          scope: schema.mcpActionAudit.scope,
          status: schema.mcpActionAudit.status,
          userId: schema.mcpActionAudit.userId,
          clientId: schema.mcpActionAudit.clientId,
          resultSummary: schema.mcpActionAudit.resultSummary,
          createdAt: schema.mcpActionAudit.createdAt,
        })
        .from(schema.mcpActionAudit)
        .where(
          scoped(
            schema.mcpActionAudit.organizationId,
            principal.organizationId,
            and(
              input.action ? eq(schema.mcpActionAudit.action, input.action) : undefined,
              input.status ? eq(schema.mcpActionAudit.status, input.status) : undefined
            )
          )
        )
        .orderBy(desc(schema.mcpActionAudit.createdAt))
        .limit(input.limit ?? 50);

      const entries = rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      }));
      return {
        text: `Se encontraron ${entries.length} registro(s) de auditoría.`,
        structuredContent: { count: entries.length, entries },
      };
    },
  }),
];
