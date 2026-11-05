import { withAuth } from "@/lib/api";
import type { SlotDto } from "@/lib/agenda/dto";
import { toSlotDto } from "@/lib/agenda/slot-view";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { computeAvailability } from "@/server/agenda/availability";
import { getSettings } from "@/server/agenda/settings";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 015 — Los huecos libres, para el operador.
 *
 * Son los huecos DE QUIEN ESTÁ EN PANTALLA: sus horarios configurados, con los
 * del negocio como respaldo. La exclusividad del instante sigue siendo del
 * negocio —una cita de un compañero también ocupa el hueco—, que es lo que
 * impide citar a dos clientes a la misma hora.
 *
 * A diferencia de la superficie del bot, esta NO registra oferta: es la vista
 * de quien ya está mirando la agenda y elige de lo que ve.
 *
 * Sin huecos responde `{"slots":[]}` con 200: agenda llena es una respuesta,
 * no un error.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const rawDuration = Number(url.searchParams.get("durationMinutes"));
  const durationMinutes = Number.isFinite(rawDuration)
    ? Math.max(5, Math.min(600, Math.round(rawDuration)))
    : undefined;

  const settings = await getSettings(session.organizationId, session.userId);
  const now = new Date();
  const slots = await computeAvailability(session.organizationId, {
    fromISO: from && ISO_DATE.test(from) ? from : undefined,
    toISO: to && ISO_DATE.test(to) ? to : undefined,
    settings,
    now,
    durationMinutes,
  });

  // Anotado con el tipo que lee la rejilla: si el mapeo se queda corto, esto
  // rompe la compilación en vez de pintar `undefined` en pantalla.
  const view: SlotDto[] = slots.map((s) => toSlotDto(s, settings.timezone, now));

  return Response.json({ slots: view });
});
