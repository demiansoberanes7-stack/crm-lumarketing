import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { mcpActionAudit } from "@/lib/db/schema";
import type { McpActionKind, McpPrincipal } from "@/server/mcp/oauth";

/**
 * Persistencia de trazabilidad: cada acción MCP de escritura/borrado/envío
 * queda en `mcp_action_audit` (borrada en cascada con la organización). Nunca
 * lanza: una tabla caída no debe tumbar una operación ya ejecutada.
 */

const MAX_INPUT_CHARS = 2000;
const MAX_SUMMARY_CHARS = 500;

export type McpAuditEntry = {
  principal: McpPrincipal;
  action: string;
  domain: string;
  kind: McpActionKind;
  scope: string;
  status: "ok" | "error";
  input?: unknown;
  resultSummary?: string;
};

function safeJson(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return null;
    return json.length > max ? `${json.slice(0, max)}…` : json;
  } catch {
    return null;
  }
}

export async function recordMcpAction(entry: McpAuditEntry): Promise<void> {
  if (entry.kind === "read") return;
  try {
    await getDb()
      .insert(mcpActionAudit)
      .values({
        id: newId("mcpAudit"),
        organizationId: entry.principal.organizationId,
        userId: entry.principal.userId,
        clientId: entry.principal.clientId,
        action: entry.action,
        domain: entry.domain,
        kind: entry.kind,
        scope: entry.scope,
        status: entry.status,
        input: safeJson(entry.input, MAX_INPUT_CHARS),
        resultSummary: entry.resultSummary?.slice(0, MAX_SUMMARY_CHARS) ?? null,
      });
  } catch (error) {
    console.error("[mcp] no se pudo auditar la acción", entry.action, error);
  }
}
