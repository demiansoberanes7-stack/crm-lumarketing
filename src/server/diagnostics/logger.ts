import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { sql } from "drizzle-orm";
import { diagnosticMetadata, errorCode } from "./redact";

const messages = {
  api_failed: "Una operación del sistema falló. Revisa la configuración del módulo y vuelve a intentar.",
  connection_failed: "Falló la prueba de conexión. Revisa credenciales, permisos y disponibilidad del proveedor.",
  connection_saved: "Configuración de conexión guardada y verificada.",
  provider_activated: "Proveedor de WhatsApp activado.",
  disconnected: "Conexión desconectada del CRM.",
  webhook_failed: "No se pudo procesar el webhook. El proveedor puede reintentar la entrega.",
  webhook_received: "Webhook autenticado y procesado correctamente.",
  subscription_failed: "Credenciales guardadas, pero falló la suscripción de Meta. Repara la suscripción desde WhatsApp Cloud API.",
  session_changed: "Estado de la sesión WAHA actualizado.",
  session_action: "Acción de sesión WAHA completada.",
  send_failed: "No se pudo enviar el mensaje. Revisa el estado de la conexión y el error en la conversación.",
  media_failed: "No se pudo descargar el adjunto. Revisa la conexión y disponibilidad del archivo.",
  ai_failed: "El proveedor de IA no pudo completar el turno. Revisa token, modelo y disponibilidad.",
} as const;
export type DiagnosticCode = keyof typeof messages;
let lastPurge = 0;

/** Best effort, bounded, with a sanitized stdout fallback if PostgreSQL is unavailable. */
export async function recordDiagnostic(input: {
  organizationId: string;
  source: string;
  code: DiagnosticCode;
  severity?: "info" | "warning" | "error";
  error?: unknown;
  metadata?: Record<string, unknown>;
}) {
  const metadata = diagnosticMetadata(input.metadata);
  const safe = { source: input.source, code: input.code, severity: input.severity ?? "error", errorCode: errorCode(input.error), ...metadata };
  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '1500ms'`);
      await tx.execute(sql`INSERT INTO diagnostic_event (id, organization_id, source, severity, code, message, metadata)
        VALUES (${randomUUID()}, ${input.organizationId}, ${input.source}, ${safe.severity}, ${input.code}, ${messages[input.code]}, ${JSON.stringify(safe)}::jsonb)`);
      if (Date.now() - lastPurge > 3600000) {
        await tx.execute(sql`DELETE FROM diagnostic_event WHERE created_at < now() - interval '30 days'`);
        lastPurge = Date.now();
      }
    });
  } catch {
    console.warn("[diagnostics]", JSON.stringify(safe));
  }
}
