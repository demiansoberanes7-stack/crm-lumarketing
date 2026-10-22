import { intParam, withOwner } from "@/lib/api";
import {
  atribucionDisabledResponse,
  atribucionEnabled,
} from "@/server/attribution/flag";
import {
  ACTIVITY_DEFAULT_LIMIT,
  listConversionActivity,
} from "@/server/attribution/conversions";

export const dynamic = "force-dynamic";

/**
 * 016 — Actividad reciente de conversiones (solo lectura).
 *
 * Responde la única pregunta que importa cuando uno duda de esto: "¿le está
 * llegando algo a Meta y, si no, por qué?". Sin acciones: este endpoint jamás
 * escribe.
 */
export const GET = withOwner(async (session, req: Request) => {
  if (!atribucionEnabled()) return atribucionDisabledResponse();
  // Un límite fuera de rango se recorta, no falla: es un panel, no un contrato
  // de paginación. Sin `intParam`, `?limit=-1` llegaba como `LIMIT -1` y
  // Postgres contestaba con un 500 en vez de la actividad.
  const limit = intParam(new URL(req.url), "limit", {
    fallback: ACTIVITY_DEFAULT_LIMIT,
    min: 1,
    max: 200,
  });
  const events = await listConversionActivity(session.organizationId, limit);
  return Response.json({ events });
});
