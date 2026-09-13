import { withAuth, apiError } from "@/lib/api";
import { getEmailAccountCredentials } from "@/server/email/service";
export const POST = withAuth(async (session, _req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const creds = await getEmailAccountCredentials(session.organizationId, (await params).id);
  if (!creds) return apiError(404, "not_found", "Cuenta no encontrada");
  const { ImapFlow } = await import("imapflow");
  const { createTransport } = await import("nodemailer");
  const imap = new ImapFlow({ host: creds.imapHost, port: creds.imapPort, secure: creds.imapSecure, auth: { user: creds.imapUser, pass: creds.imapPassword }, logger: false, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
  const smtp = createTransport({ host: creds.smtpHost, port: creds.smtpPort, secure: creds.smtpSecure, auth: { user: creds.smtpUser, pass: creds.smtpPassword }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
  try { await imap.connect(); await smtp.verify(); return Response.json({ ok: true }); }
  catch { return apiError(422, "connection_failed", "No se pudo validar IMAP y SMTP. Revisa servidores, puertos y credenciales."); }
  finally { imap.close(); smtp.close(); }
});
