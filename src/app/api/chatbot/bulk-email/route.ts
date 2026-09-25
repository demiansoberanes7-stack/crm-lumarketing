import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { sendEmail } from "@/server/email/service";

export const dynamic = "force-dynamic";

const bulkSchema = z.object({
  contactIds: z.array(z.string().min(1)).min(1).max(100),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(50000),
  emailAddresses: z.array(z.string().email()).max(100).optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bulkSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const { subject, body: emailBody, contactIds, emailAddresses } = body.data;

  const emailAccounts = await db
    .select({ id: schema.emailAccount.id })
    .from(schema.emailAccount)
    .where(
      scoped(schema.emailAccount.organizationId, session.organizationId)
    )
    .limit(1);

  if (emailAccounts.length === 0) {
    return apiError(422, "no_email_account", "No hay cuenta de email configurada");
  }

  // Resolve email addresses from contacts if not provided directly
  let recipients: string[] = emailAddresses ?? [];
  if (recipients.length === 0) {
    const contacts = await db
      .select({ id: schema.contact.id, ficha: schema.contact.ficha })
      .from(schema.contact)
      .where(
        scoped(schema.contact.organizationId, session.organizationId)
      )
      .limit(200);

    const contactMap = new Map(contacts.map((c) => [c.id, c.ficha]));
    const seen = new Set<string>();

    for (const cid of contactIds) {
      const ficha = contactMap.get(cid) as Record<string, unknown> | null;
      if (!ficha) continue;
      // Try common email field names in ficha
      const email = ficha.email ?? ficha.correo ?? ficha.emailAddress;
      if (typeof email === "string" && email.includes("@") && !seen.has(email.toLowerCase())) {
        seen.add(email.toLowerCase());
        recipients.push(email);
      }
    }
  }

  // Deduplicate
  recipients = [...new Set(recipients.map((e) => e.trim().toLowerCase()))];

  if (recipients.length === 0) {
    return apiError(422, "no_emails", "Ningun contacto tiene direccion de email valida");
  }

  const accountId = emailAccounts[0]!.id;
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const email of recipients) {
    try {
      await sendEmail(session.organizationId, accountId, {
        to: email,
        subject,
        text: emailBody,
      });
      sent++;
    } catch (err) {
      failed++;
      errors.push(`${email}: ${err instanceof Error ? err.message : "Error desconocido"}`);
    }
  }

  return Response.json({
    sent,
    failed,
    message: `${sent} correo${sent !== 1 ? "s" : ""} enviado${sent !== 1 ? "s" : ""}${failed > 0 ? `, ${failed} fallido${failed !== 1 ? "s" : ""}` : ""}`,
    errors: errors.length > 0 ? errors : undefined,
  });
});
