import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { changeQuoteStatus } from "@/server/quotes/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  status: z.enum(["accepted", "rejected"]),
});

/** POST — cambiar estado de cotización a aceptada o rechazada */
export const POST = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;

  try {
    await changeQuoteStatus(session.organizationId, id, body.data.status);
    return Response.json({ ok: true });
  } catch (err) {
    return apiError(400, "status_change_failed", String(err));
  }
});
