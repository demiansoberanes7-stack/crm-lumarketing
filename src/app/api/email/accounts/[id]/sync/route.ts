import { apiError, withAuth } from "@/lib/api";
import { EmailAccountUnavailableError, syncInbox } from "@/server/email/service";
import { recordDiagnostic } from "@/server/diagnostics/logger";
import { safeDiagnosticText } from "@/server/diagnostics/redact";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

/** POST — sincronizar inbox IMAP */
export const POST = withAuth(async (session, _req, { params }) => {
  const { id } = await params;

  try {
    const synced = await syncInbox(session.organizationId, id);
    return Response.json({ ok: true, synced });
  } catch (err) {
    // Cuenta apagada, inexistente o con cifrado ilegible: es un estado que la
    // pantalla ya explica. Registrarlo como error llenaba Diagnóstico de ruido
    // cada vez que se abría el buzón.
    if (err instanceof EmailAccountUnavailableError) {
      return apiError(409, "account_unavailable", err.message);
    }
    await recordDiagnostic({
      organizationId: session.organizationId,
      source: "email",
      code: "email_sync_failed",
      error: err,
      metadata: { operation: "sync-inbox", provider: "imap", accountId: id },
    });
    const detail = err instanceof Error ? safeDiagnosticText(err.message, 500) : "Error IMAP";
    return apiError(502, "sync_failed", `No se pudo sincronizar el correo: ${detail}`);
  }
});
