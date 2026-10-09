import { withAuth, apiError } from "@/lib/api";
import { getEmailAccountCredentials } from "@/server/email/service";
import { recordDiagnostic } from "@/server/diagnostics/logger";
import { safeDiagnosticText } from "@/server/diagnostics/redact";

export const POST = withAuth(async (session, _req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const creds = await getEmailAccountCredentials(session.organizationId, (await params).id);
  if (!creds) return apiError(404, "not_found", "Cuenta no encontrada");
  const { ImapFlow } = await import("imapflow");
  const { createTransport } = await import("nodemailer");
  const imap = new ImapFlow({ host: creds.imapHost, port: creds.imapPort, secure: creds.imapSecure, auth: { user: creds.imapUser, pass: creds.imapPassword }, logger: false, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
  const smtp = createTransport({ host: creds.smtpHost, port: creds.smtpPort, secure: creds.smtpSecure, requireTLS: !creds.smtpSecure, auth: { user: creds.smtpUser, pass: creds.smtpPassword }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
  try {
    await imap.connect();
    await smtp.verify();
    return Response.json({
      ok: true,
      message: "Conexión IMAP/SMTP verificada. Esto no comprueba la llegada a Inbox; configura SPF, DKIM y DMARC en el DNS del dominio remitente.",
    });
  } catch (error) {
    await recordDiagnostic({
      organizationId: session.organizationId,
      source: "email",
      code: "connection_failed",
      severity: "warning",
      error,
      metadata: { operation: "verify-imap-smtp", provider: "smtp-imap", requestId: (await params).id },
    });
    const detail = error instanceof Error ? safeDiagnosticText(error.message, 500) : "Error de conexión";
    return apiError(422, "connection_failed", `No se pudo validar IMAP/SMTP: ${detail}`);
  }
  finally { imap.close(); smtp.close(); }
});
