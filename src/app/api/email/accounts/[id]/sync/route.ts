import { apiError, withAuth } from "@/lib/api";
import { syncInbox } from "@/server/email/service";
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
