import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { updateLead } from "@/server/leads/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  /**
   * Opcionales desde que el lead tiene monto: capturar dinero es un gesto
   * distinto de mover la tarjeta, y exigir la etapa para guardar un importe
   * obligaría al cliente a reenviar dónde estaba —con el riesgo de moverlo sin
   * querer si el tablero venía desfasado—. Sin `stageId` no se mueve nada.
   */
  stageId: z.string().min(1).optional(),
  position: z.number().int().min(0).optional(),
  /**
   * Obligatorio al ENTRAR a una etapa perdida. No se valida aquí sino en la
   * puerta: la regla es del dominio, no de esta ruta, y hay más caminos que
   * mueven tarjetas.
   */
  lossReason: z
    .enum([
      "precio",
      "no_es_perfil",
      "sin_presupuesto",
      "eligio_otro",
      "nunca_contesto",
      "otro",
    ])
    .optional(),
  lossNote: z.string().max(500).optional(),
  /**
   * Monto en centavos enteros. `null` explícito lo borra; ausente lo deja como
   * estaba — capturar el monto y mover la tarjeta son dos gestos distintos y
   * uno no debe pisar al otro.
   */
  amountCents: z.number().int().min(0).max(1_000_000_000_00).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  /** `null` explícito la quita; ausente la deja como estaba. */
  priority: z.enum(["alta", "media", "baja"]).nullable().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  // Misma fuente que el MCP: mover, capturar monto y cambiar prioridad viven
  // en un solo lugar (server/leads/service.ts).
  const result = await updateLead({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    leadId: id,
    stageId: body.data.stageId,
    position: body.data.position,
    lossReason: body.data.lossReason ?? null,
    lossNote: body.data.lossNote ?? null,
    amountCents: body.data.amountCents,
    currency: body.data.currency,
    priority: body.data.priority,
  });

  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 422;
    return apiError(status, result.code, result.message);
  }
  return Response.json({ lead: result.lead });
});
