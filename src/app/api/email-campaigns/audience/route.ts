import { parseBody, withAuth } from "@/lib/api";
import {
  emailAudienceCounts,
  listEmailRecipients,
} from "@/server/email-campaigns/audience";
import { previewEmailAudienceSchema } from "@/server/email-campaigns/schema";
import { EMAIL_AUDIENCE_LIMIT } from "@/server/email-campaigns/recipients";

export const dynamic = "force-dynamic";

/** Conteos de las audiencias que ya viven en el CRM. */
export const GET = withAuth(async (session) => {
  const counts = await emailAudienceCounts(session.organizationId);
  return Response.json({ ...counts, limit: EMAIL_AUDIENCE_LIMIT });
});

/** Vista previa de una carga manual o de un archivo ya leído. */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, previewEmailAudienceSchema);
  if (!body.ok) return body.response;
  if (body.data.kind !== "list") {
    // Contacts y mailbox comparten las mismas expresiones que el envío real;
    // se cuentan en SQL en vez de materializar miles de filas para la vista.
    const counts = await emailAudienceCounts(session.organizationId);
    return Response.json({
      count: body.data.kind === "contacts" ? counts.contacts : counts.mailbox,
      sample: [],
      limit: EMAIL_AUDIENCE_LIMIT,
    });
  }
  const recipients = listEmailRecipients(body.data);
  return Response.json({
    count: recipients.length,
    sample: recipients.slice(0, 8),
    overLimit: recipients.length > EMAIL_AUDIENCE_LIMIT,
    limit: EMAIL_AUDIENCE_LIMIT,
  });
});
