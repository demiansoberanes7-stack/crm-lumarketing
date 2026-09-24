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
  emailAddresses: z.array(z.string().email()).min(1).max(100),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bulkSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const { subject, body: emailBody, emailAddresses } = body.data;

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

  const accountId = emailAccounts[0]!.id;
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const email of emailAddresses) {
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
