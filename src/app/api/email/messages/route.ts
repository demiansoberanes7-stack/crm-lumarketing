import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { listMessages, sendEmail } from "@/server/email/service";

export const dynamic = "force-dynamic";

/** GET — listar mensajes */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId");
  if (!accountId) return apiError(400, "missing_param", "accountId es requerido");

  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");
  const direction = url.searchParams.get("direction") ?? undefined;

  const messages = await listMessages(session.organizationId, accountId, {
    limit,
    offset,
    direction,
  });
  return Response.json({ messages });
});

const sendSchema = z.object({
  accountId: z.string().min(1),
  to: z.string().email(),
  subject: z.string().min(1),
  text: z.string().optional(),
  html: z.string().optional(),
  inReplyTo: z.string().nullable().optional(),
  attachments: z.array(z.object({
    filename: z.string().min(1),
    content: z.string().min(1),
    contentType: z.string().min(1),
  })).max(10).optional(),
});

/** POST — enviar email */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, sendSchema);
  if (!body.ok) return body.response;

  try {
    const messageId = await sendEmail(session.organizationId, body.data.accountId, {
      to: body.data.to,
      subject: body.data.subject,
      text: body.data.text,
      html: body.data.html,
      inReplyTo: body.data.inReplyTo ?? undefined,
      attachments: body.data.attachments,
    });
    return Response.json({ ok: true, messageId });
  } catch (err) {
    return apiError(500, "send_failed", String(err));
  }
});
