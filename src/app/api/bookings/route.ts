import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { addDaysISO, dayIsoInTz, zonedWallClockToUtc } from "@/lib/time/slots";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { listBookings } from "@/server/agenda/queries";
import { createBlock, createSessionBooking } from "@/server/agenda/service";
import { getSettings } from "@/server/agenda/settings";
import { bookingErrorResponse, bookingPayload } from "@/server/agenda/http";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * La lista, optionally recortada a una ventana `[from, to]` en fechas de pared
 * del negocio. Sin parámetros trae lo de siempre: las citas más recientes.
 *
 * La ventana se pide por FECHAS, no por instantes: quien mira un mes en
 * pantalla piensa en «del 1 al 31 de este mes», y eso solo se traduce bien en
 * la zona horaria configurada.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const mine = url.searchParams.get("mine");

  // La zona con la que se dibuja y se traduce la ventana es la de QUIEN mira
  // (cascada usuario → negocio), igual que en /api/calendar/availability. Si
  // cada endpoint usara la suya, los bordes del mes y los huecos no cuadrarían.
  const settings = await getSettings(session.organizationId, session.userId);
  const now = new Date();
  const fromUtc =
    from && ISO_DATE.test(from)
      ? zonedWallClockToUtc(from, "00:00", settings.timezone)
      : null;
  const toUtc =
    to && ISO_DATE.test(to)
      ? zonedWallClockToUtc(addDaysISO(to, 1), "00:00", settings.timezone)
      : null;

  const bookings = await listBookings(session.organizationId, {
    fromUtc: fromUtc ?? undefined,
    toUtc: toUtc ?? undefined,
    userId: mine === "1" ? session.userId : undefined,
    timezone: settings.timezone,
  });

  return Response.json({
    bookings,
    timezone: settings.timezone,
    // La ventana que realmente se usó, para que el cliente no vuelva a adivinar
    // en qué zona está pintando.
    today: dayIsoInTz(now, settings.timezone),
  });
});

const postSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("session"),
    // Opcional: hay citas que no corresponden a nadie del CRM (una visita, un
    // show-up). El camino del bot sigue exigiendo contacto.
    contactId: z.string().min(1).nullish(),
    conversationId: z.string().min(1).nullish(),
    startUtc: z.string().min(1),
    title: z.string().max(255).nullish(),
    location: z.string().max(255).nullish(),
    durationMinutes: z.number().int().min(5).max(600).nullish(),
    notes: z.string().nullish(),
  }),
  z.object({
    kind: z.literal("block"),
    startUtc: z.string().min(1),
    durationMinutes: z.number().int().min(5).max(600),
    notes: z.string().nullish(),
  }),
]);

/**
 * 015 — El operador agenda o bloquea.
 *
 * Responde **201**, igual que la superficie del bot: el código de creación es
 * contrato, no un detalle.
 *
 * A diferencia del agente, el operador NO pasa por `offered_slot`: elige de la
 * disponibilidad que está viendo en pantalla. La re-validación y el candado
 * anti doble-booking sí aplican igual.
 *
 * La cita manual queda a nombre de quien la crea (`session.userId`): es el
 * responsable que muestra el calendario y cuyos horarios se respetaron.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  try {
    if (body.data.kind === "block") {
      const block = await createBlock({
        organizationId: session.organizationId,
        userId: session.userId,
        startUtc: body.data.startUtc,
        durationMinutes: body.data.durationMinutes,
        notes: body.data.notes ?? null,
      });
      return Response.json({ booking: { id: block.id } }, { status: 201 });
    }

    const result = await createSessionBooking({
      organizationId: session.organizationId,
      userId: session.userId,
      contactId: body.data.contactId ?? null,
      conversationId: body.data.conversationId ?? null,
      startUtc: body.data.startUtc,
      title: body.data.title ?? null,
      location: body.data.location ?? null,
      durationMinutes: body.data.durationMinutes ?? undefined,
      notes: body.data.notes ?? null,
      source: "manual",
      requireOffer: false,
    });
    return Response.json(
      { booking: { id: result.booking.id }, ...bookingPayload(result) },
      { status: 201 }
    );
  } catch (err) {
    return bookingErrorResponse(err);
  }
});
