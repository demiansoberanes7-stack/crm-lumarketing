import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { describeSendErrorText } from "@/lib/meta/send-errors";
import { sendQuote } from "@/server/quotes/service";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

const sendSchema = z.object({
  channel: z.enum(["whatsapp", "instagram", "messenger"]),
  /** 053: chat elegido en el desplegable; opcional (si no, va al del contacto). */
  conversationId: z.string().min(1).max(64).optional(),
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
      body.data.channel,
      body.data.conversationId
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const raw = String(err);
    // El guard de ventana de la inbox no trae código de Meta, pero tampoco
    // dice nada útil ("window_closed"): se traduce aparte.
    const message = /window_closed/i.test(raw)
      ? "La ventana de 24 h está cerrada: pide al cliente que responda un mensaje antes de enviar la cotización."
      : describeSendErrorText(raw);
    return apiError(400, "send_failed", message);
  }
});
