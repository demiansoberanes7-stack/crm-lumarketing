import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { SendError, sendText } from "@/server/inbox/send";

export const dynamic = "force-dynamic";

const bulkSchema = z.object({
  contactIds: z.array(z.string().min(1)).min(1).max(100),
  message: z.string().trim().min(1).max(4096),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bulkSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const { contactIds, message } = body.data;

  const contacts = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      scoped(schema.contact.organizationId, session.organizationId)
    )
    .limit(200);

  const validIds = new Set(contacts.map((c) => c.id));
  const targetIds = contactIds.filter((id) => validIds.has(id));

  if (targetIds.length === 0) {
    return apiError(422, "no_contacts", "Ningun contacto valido seleccionado");
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const contactId of targetIds) {
    try {
      const conversation = await getOrCreateConversation(
        session.organizationId,
        contactId
      );
      await sendText({
        conversationId: conversation.id,
        organizationId: session.organizationId,
        text: message,
      });
      sent++;
    } catch (err) {
      failed++;
      if (err instanceof SendError) {
        errors.push(`${contactId}: ${err.message}`);
      } else {
        errors.push(`${contactId}: Error desconocido`);
      }
    }
  }

  return Response.json({
    sent,
    failed,
    message: `${sent} mensaje${sent !== 1 ? "s" : ""} enviado${sent !== 1 ? "s" : ""}${failed > 0 ? `, ${failed} fallido${failed !== 1 ? "s" : ""}` : ""}`,
    errors: errors.length > 0 ? errors : undefined,
  });
});
