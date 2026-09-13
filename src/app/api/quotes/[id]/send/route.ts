import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { sendQuote } from "@/server/quotes/service";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

const sendSchema = z.object({
  channel: z.enum(["whatsapp", "instagram", "messenger"]),
});

/** POST — enviar cotización por canal */
export const POST = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, sendSchema);
  if (!body.ok) return body.response;

  try {
    const result = await sendQuote(
      session.organizationId,
      id,
      body.data.channel
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return apiError(400, "send_failed", String(err));
  }
});
