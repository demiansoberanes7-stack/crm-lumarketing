import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { describeSendErrorText } from "@/lib/meta/send-errors";
import { sendProductToConversation } from "@/server/catalog/send";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

const sendSchema = z.object({
  conversationId: z.string().min(1).max(64),
});

/** POST — enviar la ficha de un producto a un chat (canal según la conversación). */
export const POST = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, sendSchema);
  if (!body.ok) return body.response;

  try {
    const result = await sendProductToConversation(
      session.organizationId,
      id,
      body.data.conversationId
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const raw = String(err);
    const message = /window_closed/i.test(raw)
      ? "La ventana de 24 h está cerrada: pide al cliente que responda un mensaje antes de enviar el producto."
      : describeSendErrorText(raw);
    return apiError(400, "send_failed", message);
  }
});
