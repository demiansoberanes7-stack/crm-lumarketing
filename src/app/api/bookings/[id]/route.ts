import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import {
  cancelBooking,
  markBookingStatus,
  rescheduleBooking,
  retryMeetingLink,
  updateBooking,
} from "@/server/agenda/service";
import { bookingErrorResponse } from "@/server/agenda/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reschedule"), startUtc: z.string().min(1) }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("status"),
    status: z.enum(["realizada", "no_show"]),
  }),
  z.object({ action: z.literal("retry_link") }),
  // Editar lo que la cita ES, sin mover su instante. Los campos que no llegan
  // se dejan como estaban; `null` los borra.
  z.object({
    action: z.literal("update"),
    title: z.string().max(255).nullish(),
    location: z.string().max(255).nullish(),
    notes: z.string().nullish(),
    durationMinutes: z.number().int().min(5).max(600).nullish(),
  }),
]);

/**
 * 015 — Reprogramar, cancelar (idempotente), marcar el resultado, reintentar el
 * enlace que el proveedor no entregó y editar los campos de la cita.
 */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  try {
    switch (body.data.action) {
      case "reschedule": {
        const result = await rescheduleBooking({
          organizationId: session.organizationId,
          bookingId: id,
          startUtc: body.data.startUtc,
        });
        return Response.json({ ok: true, label: result.label });
      }
      case "cancel": {
        await cancelBooking({
          organizationId: session.organizationId,
          bookingId: id,
        });
        return Response.json({ ok: true });
      }
      case "status": {
        await markBookingStatus({
          organizationId: session.organizationId,
          bookingId: id,
          status: body.data.status,
        });
        return Response.json({ ok: true });
      }
      case "retry_link": {
        const result = await retryMeetingLink({
          organizationId: session.organizationId,
          bookingId: id,
        });
        return Response.json({
          ok: true,
          meetingLink: result.meetingLink,
          linkPending: result.linkPending,
        });
      }
      case "update": {
        const result = await updateBooking({
          organizationId: session.organizationId,
          bookingId: id,
          title: body.data.title,
          location: body.data.location,
          notes: body.data.notes,
          durationMinutes: body.data.durationMinutes,
        });
        return Response.json({ ok: true, label: result.label });
      }
    }
  } catch (err) {
    return bookingErrorResponse(err);
  }
});
