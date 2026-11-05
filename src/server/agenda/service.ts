import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { descNullsLast } from "@/lib/db/order";
import { scoped } from "@/lib/db/tenant";
import { labelInTz } from "@/lib/time/slots";
import { publishWebhook } from "@/server/webhooks/dispatcher";
import { CONNECTOR_META, type ConnectorId } from "@/lib/agenda-connectors";
import {
  computeAvailability,
  findSlot,
  findSlotClash,
  lockBookingSlots,
  type AvailableSlot,
} from "@/server/agenda/availability";
import { getSettings, type CalendarSettings } from "@/server/agenda/settings";
import {
  clearOffers,
  findOffered,
  getOffers,
  replaceOffers,
  type OfferedSlot,
} from "@/server/agenda/offers";
import {
  bindConnector,
  markConnectorAuthError,
} from "@/server/agenda/connectors";
import { ConnectorError } from "@/server/agenda/connectors/types";
import {
  bookingDescription,
  bookingSummary,
  syncBookingEvent,
} from "@/server/agenda/bookings-sync";
import { moveLeadToStage } from "@/server/leads/stage-history";
import { publish } from "@/server/events/bus";

/**
 * 015 — Ciclo de vida de la cita y las dos reglas INNEGOCIABLES:
 *
 *  1. Quien conduce la conversación (agente in-process o cerebro externo) solo
 *     puede reservar un instante que ya se ofreció a ESA conversación
 *     (`offered_slot`, comparación por epoch exacto).
 *  2. Al confirmar se re-valida el hueco y la base lo cierra con su índice
 *     único parcial; si se ocupó, se responde `slot_taken` con alternativas
 *     frescas y NO se crea nada. Nunca se confirma una reserva que no se creó.
 *     La escritura va ADEMÁS dentro de una transacción con el candado por
 *     negocio (`lockBookingSlots`) y el chequeo de solape, porque el índice
 *     único solo ve el instante exacto y una reunión de 60 puede cabalgar dos
 *     slots de 30 sin chocar con ninguna llave.
 *
 * Y una regla de honestidad: la entrega de la reunión (el conector) corre
 * DESPUÉS de escribir la verdad del CRM y es best-effort. Si el proveedor está
 * caído, la cita se crea igual con el enlace pendiente — un tercero no puede
 * costarnos la conversión, ni hacernos prometer un enlace que no existe.
 */

export type BookingErrorCode =
  | "slot_taken"
  | "slot_not_offered"
  | "not_found"
  | "invalid";

export class BookingError extends Error {
  code: BookingErrorCode;
  /**
   * Horarios para re-ofrecer. En `slot_taken` son alternativas frescas YA
   * registradas como la nueva oferta de la conversación; en `slot_not_offered`
   * es lo que sí se había ofrecido.
   */
  slots: OfferedSlot[];

  constructor(
    code: BookingErrorCode,
    message: string,
    slots: OfferedSlot[] = []
  ) {
    super(message);
    this.name = "BookingError";
    this.code = code;
    this.slots = slots;
  }
}

type BookingRow = typeof schema.booking.$inferSelect;

export type BookingResult = {
  booking: BookingRow;
  meetingLink: string | null;
  linkPending: boolean;
  label: string;
};

/** Cuántas alternativas se devuelven cuando el hueco se ocupó. */
const FRESH_ALTERNATIVES = 3;

export async function createSessionBooking(input: {
  organizationId: string;
  startUtc: string;
  source: "manual" | "ai";
  /** Obligatoria en el camino conversacional; de ella sale el contacto. */
  conversationId?: string | null;
  /** Camino manual del operador. */
  contactId?: string | null;
  notes?: string | null;
  /** Motivo de la cita; en null se muestra el título por defecto. */
  title?: string | null;
  /** Lugar o modalidad (sala, enlace, domicilio…). */
  location?: string | null;
  /** Quién atiende la cita. En el camino manual, quien está en la sesión. */
  userId?: string | null;
  /** Duración pedida; sin valor, la rejilla configurada. */
  durationMinutes?: number;
  /**
   * true ⇒ exige que el instante figure entre los ofrecidos a la conversación
   * (agente/bot). El operador elige de la disponibilidad que está viendo, así
   * que reserva sin oferta previa.
   */
  requireOffer: boolean;
  now?: Date;
}): Promise<BookingResult> {
  const db = getDb();
  const settings = await getSettings(input.organizationId, input.userId);
  const durationMinutes = resolveDuration(input.durationMinutes, settings.slotMinutes);

  if (Number.isNaN(Date.parse(input.startUtc))) {
    throw new BookingError("invalid", "Instante inválido");
  }

  // Contexto de la conversación: contacto y si es del Laboratorio.
  let isTest = false;
  let contactId = input.contactId ?? null;
  let contactName = "";
  if (input.conversationId) {
    const rows = await db
      .select({
        contactId: schema.conversation.contactId,
        isTest: schema.conversation.isTest,
      })
      .from(schema.conversation)
      .where(
        scoped(
          schema.conversation.organizationId,
          input.organizationId,
          eq(schema.conversation.id, input.conversationId)
        )
      )
      .limit(1);
    const conv = rows[0];
    if (!conv) throw new BookingError("not_found", "Conversación no encontrada");
    // Aislamiento: si el llamador trae UN contacto y UNA conversación, tienen
    // que ser de la misma persona — mezclarlos enlazaría hilos ajenos.
    if (contactId && contactId !== conv.contactId) {
      throw new BookingError(
        "invalid",
        "El contacto no corresponde a esta conversación"
      );
    }
    isTest = conv.isTest;
    contactId = contactId ?? conv.contactId;
  }

  // El contacto sigue siendo obligatorio en el camino conversacional: sin él
  // la cita no tiene a quién atender. En el manual ya no — hay citas de
  // show-up (una llamada, una visita) que no corresponden a nadie del CRM.
  if (!contactId && input.requireOffer) {
    throw new BookingError("invalid", "La cita necesita un contacto");
  }
  // El contacto viene crudo del cliente en la ruta manual: tiene que existir
  // EN ESTA organización. Sin esto, un contactId ajeno creaba la cita igual
  // (el nombre quedaba vacío y nadie se daba cuenta).
  if (contactId) {
    contactName = await requireContactName(input.organizationId, contactId);
  }

  // REGLA 1: solo se reserva lo que se ofreció.
  if (input.requireOffer) {
    if (!input.conversationId) {
      throw new BookingError(
        "invalid",
        "Se necesita la conversación para validar la oferta"
      );
    }
    const offers = await getOffers(input.organizationId, input.conversationId);
    if (!findOffered(offers, input.startUtc)) {
      throw new BookingError(
        "slot_not_offered",
        "Ese horario no se ofreció en esta conversación",
        offers
      );
    }
  }

  // REGLA 2 (primera mitad): el hueco debe seguir libre AHORA, midiéndolo con
  // la duración real de esta cita.
  const slot = await findSlot(input.organizationId, input.startUtc, {
    now: input.now,
    settings,
    durationMinutes,
  });
  if (!slot) {
    throw new BookingError(
      "slot_taken",
      "Ese horario ya no está disponible",
      await refreshOffer(input.organizationId, input.conversationId, {
        now: input.now,
      })
    );
  }

  let leadId: string | null = null;
  if (contactId) {
    const leadRows = await db
      .select({ id: schema.lead.id })
      .from(schema.lead)
      .where(
        scoped(
          schema.lead.organizationId,
          input.organizationId,
          eq(schema.lead.contactId, contactId)
        )
      )
      .orderBy(desc(schema.lead.isPrimary), descNullsLast(schema.lead.lastActivityAt))
      .limit(1);
    leadId = leadRows[0]?.id ?? null;
  }

  let booking: BookingRow;
  try {
    // REGLA 2 (segunda mitad): candado por negocio + chequeo de solape DENTRO
    // de la transacción, y el índice único parcial como última red del choque
    // exacto. Nada más corre aquí dentro: ni el conector ni las etapas del
    // lead, para que la transacción dure lo que dura un SELECT y un INSERT.
    const claimed = await getDb().transaction(async (tx) => {
      await lockBookingSlots(tx, input.organizationId);
      const clash = await findSlotClash(tx, input.organizationId, {
        startUtc: new Date(slot.startUtc),
        endUtc: new Date(slot.endUtc),
      });
      if (clash) return null;
      const inserted = await tx
        .insert(schema.booking)
        .values({
          id: newId("booking"),
          organizationId: input.organizationId,
          userId: input.userId ?? null,
          kind: "session",
          source: input.source === "ai" ? "ai" : "manual",
          contactId,
          conversationId: input.conversationId ?? null,
          leadId,
          scheduledAt: new Date(slot.startUtc),
          durationMinutes,
          title: input.title?.trim() || null,
          location: input.location?.trim() || null,
          // Copia histórica: si el negocio cambia de conector, esta cita conserva
          // el que le tocó y sigue hablando con él al moverse o cancelarse.
          connector: settings.connector,
          isTest,
          notes: input.notes ?? null,
        })
        .returning();
      return inserted[0]!;
    });
    if (!claimed) {
      throw new BookingError(
        "slot_taken",
        "Ese horario acaba de ocuparse",
        await refreshOffer(input.organizationId, input.conversationId, {
          now: input.now,
        })
      );
    }
    booking = claimed;
  } catch (err) {
    // REGLA 2 (tercera red): la llave única cierra la carrera exacta. Dos
    // confirmaciones simultáneas del mismo instante — la perdedora sale por
    // aquí, sin cita creada.
    if (isUniqueViolation(err)) {
      throw new BookingError(
        "slot_taken",
        "Ese horario acaba de ocuparse",
        await refreshOffer(input.organizationId, input.conversationId, {
          now: input.now,
        })
      );
    }
    throw err;
  }

  // La oferta cumplió su propósito.
  if (input.conversationId) {
    await clearOffers(input.organizationId, input.conversationId).catch(
      (err) => {
        console.warn(`[agenda] no pude limpiar la oferta: ${err}`);
      }
    );
  }

  // Efectos secundarios: ninguno puede revertir la cita.
  const delivered = await deliverMeeting(booking, settings, contactName);
  if (contactId) {
    await advanceLeadStage(
      input.organizationId,
      contactId,
      input.source === "ai" ? "bot" : "dueno"
    ).catch((err) => {
      console.warn(`[agenda] avance de etapa falló: ${err}`);
    });
  }

  publish(input.organizationId, {
    type: "booking.updated",
    data: { bookingId: delivered.id },
  });

  publishWebhook(input.organizationId, "booking.created", {
    bookingId: delivered.id,
    // El contacto RESUELTO (por conversación cuando la IA no lo trae): usar
    // input.contactId crudo dejaba el campo en null justo en el flujo del bot.
    contactId,
  });

  return {
    booking: delivered,
    meetingLink: delivered.meetingLink,
    linkPending: delivered.linkPending,
    label: labelInTz(slot.startUtc, settings.timezone),
  };
}

export async function createBlock(input: {
  organizationId: string;
  startUtc: string;
  durationMinutes: number;
  notes?: string | null;
  userId?: string | null;
}): Promise<BookingRow> {
  if (Number.isNaN(Date.parse(input.startUtc))) {
    throw new BookingError("invalid", "Instante inválido");
  }
  const durationMinutes = resolveDuration(input.durationMinutes, 30);
  const start = new Date(input.startUtc);
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  const db = getDb();
  try {
    const inserted = await db.transaction(async (tx) => {
      await lockBookingSlots(tx, input.organizationId);
      // Un bloqueo no puede caer encima de una cita: el hueco ya tiene dueño.
      if (await findSlotClash(tx, input.organizationId, { startUtc: start, endUtc: end })) {
        return null;
      }
      const rows = await tx
        .insert(schema.booking)
        .values({
          id: newId("booking"),
          organizationId: input.organizationId,
          userId: input.userId ?? null,
          kind: "block",
          source: "manual",
          scheduledAt: start,
          durationMinutes,
          notes: input.notes ?? null,
        })
        .returning();
      return rows[0]!;
    });
    if (!inserted) {
      throw new BookingError("slot_taken", "Ese horario ya está ocupado");
    }
    const block = inserted;
    publish(input.organizationId, {
      type: "booking.updated",
      data: { bookingId: block.id },
    });
    publishWebhook(input.organizationId, "booking.created", {
      bookingId: block.id,
      contactId: null,
    });
    return block;
  } catch (err) {
    if (err instanceof BookingError) throw err;
    if (isUniqueViolation(err)) {
      throw new BookingError("slot_taken", "Ese horario ya está ocupado");
    }
    throw err;
  }
}

export async function rescheduleBooking(input: {
  organizationId: string;
  bookingId: string;
  startUtc: string;
  now?: Date;
}): Promise<BookingResult> {
  const booking = await getOwnBooking(input.organizationId, input.bookingId);
  if (booking.status === "cancelada") {
    throw new BookingError("invalid", "La cita está cancelada");
  }

  const settings = await getSettings(input.organizationId, booking.userId);
  // excludeBookingId: la propia cita no debe bloquearse a sí misma.
  const slot = await findSlot(input.organizationId, input.startUtc, {
    excludeBookingId: booking.id,
    now: input.now,
    settings,
    durationMinutes: booking.durationMinutes,
  });
  if (!slot) {
    throw new BookingError("slot_taken", "Ese horario ya no está disponible");
  }

  let next: BookingRow;
  try {
    const updated = await getDb().transaction(async (tx) => {
      await lockBookingSlots(tx, input.organizationId);
      // El índice único solo ve el instante exacto; aquí se ve también el
      // solape, porque la cita que se mueve puede medir más que la rejilla.
      if (
        await findSlotClash(tx, input.organizationId, {
          startUtc: new Date(slot.startUtc),
          endUtc: new Date(slot.endUtc),
          excludeBookingId: booking.id,
        })
      ) {
        return null;
      }
      const rows = await tx
        .update(schema.booking)
        .set({ scheduledAt: new Date(slot.startUtc), updatedAt: new Date() })
        .where(eq(schema.booking.id, booking.id))
        .returning();
      return rows[0]!;
    });
    if (!updated) {
      throw new BookingError("slot_taken", "Ese horario acaba de ocuparse");
    }
    next = updated;
  } catch (err) {
    if (err instanceof BookingError) throw err;
    if (isUniqueViolation(err)) {
      throw new BookingError("slot_taken", "Ese horario acaba de ocuparse");
    }
    throw err;
  }

  // Mover la reunión en el proveedor conserva el enlace: es la MISMA reunión,
  // en otra hora. Un fallo aquí no deshace nada — el enlace anterior sigue
  // sirviendo en la práctica.
  await withConnector(next, settings, async (conn, externalRef) => {
    await conn.updateMeeting(externalRef, {
      startUtc: slot.startUtc,
      durationMinutes: next.durationMinutes,
      timezone: settings.timezone,
      // Con Google la reunión y el evento de calendario son el mismo objeto, así
      // que el evento se reordena Y se reetiqueta en el mismo PATCH: si no, al
      // mover una cita el calendario se quedaría con la hora vieja.
      summary: await bookingSummary(input.organizationId, next),
      description: bookingDescription(next),
      location: next.location ?? undefined,
    });
  });
  await syncBookingEvent(input.organizationId, next.id);

  publish(input.organizationId, {
    type: "booking.updated",
    data: { bookingId: next.id },
  });

  publishWebhook(input.organizationId, "booking.updated", {
    bookingId: next.id,
    contactId: next.contactId ?? null,
  });

  return {
    booking: next,
    meetingLink: next.meetingLink,
    linkPending: next.linkPending,
    label: labelInTz(slot.startUtc, settings.timezone),
  };
}

/**
 * Reprograma la PRÓXIMA cita activa de la conversación. Es el camino del
 * agente: mover una cita no debería obligar a pausar la IA y pasarle el
 * problema a un humano.
 */
export async function rescheduleForConversation(input: {
  organizationId: string;
  conversationId: string;
  startUtc: string;
  now?: Date;
}): Promise<BookingResult> {
  const db = getDb();
  const now = input.now ?? new Date();

  const convRows = await db
    .select({ contactId: schema.conversation.contactId })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        input.organizationId,
        eq(schema.conversation.id, input.conversationId)
      )
    )
    .limit(1);
  const conv = convRows[0];
  if (!conv) throw new BookingError("not_found", "Conversación no encontrada");

  // Mismas reglas que al crear: el instante nuevo tiene que haberse ofrecido.
  const offers = await getOffers(input.organizationId, input.conversationId);
  if (!findOffered(offers, input.startUtc)) {
    throw new BookingError(
      "slot_not_offered",
      "Ese horario no se ofreció en esta conversación",
      offers
    );
  }

  const rows = await db
    .select()
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        input.organizationId,
        and(
          eq(schema.booking.contactId, conv.contactId),
          eq(schema.booking.kind, "session"),
          eq(schema.booking.status, "agendada"),
          gte(schema.booking.scheduledAt, now)
        )
      )
    )
    .orderBy(asc(schema.booking.scheduledAt))
    .limit(1);

  const target = rows[0];
  if (!target) {
    throw new BookingError("not_found", "No hay una cita activa que mover");
  }

  const result = await rescheduleBooking({
    organizationId: input.organizationId,
    bookingId: target.id,
    startUtc: input.startUtc,
    now: input.now,
  });
  await clearOffers(input.organizationId, input.conversationId).catch(() => {});
  return result;
}

/** Idempotente: cancelar una cita ya cancelada no falla ni cambia nada. */
export async function cancelBooking(input: {
  organizationId: string;
  bookingId: string;
}): Promise<void> {
  const db = getDb();
  const booking = await getOwnBooking(input.organizationId, input.bookingId);
  if (booking.status === "cancelada") return;

  await db
    .update(schema.booking)
    .set({ status: "cancelada", updatedAt: new Date() })
    .where(eq(schema.booking.id, booking.id));

  const settings = await getSettings(input.organizationId);
  await withConnector(booking, settings, async (conn, externalRef) => {
    await conn.deleteMeeting(externalRef);
  });
  // Cancelar también retira el evento del calendario. Con Google ese borrado ya
  // lo hizo `deleteMeeting` arriba — aquí queda la marca local coherente.
  await syncBookingEvent(input.organizationId, booking.id);

  publish(input.organizationId, {
    type: "booking.updated",
    data: { bookingId: booking.id },
  });
}

export async function markBookingStatus(input: {
  organizationId: string;
  bookingId: string;
  status: "realizada" | "no_show";
}): Promise<void> {
  const db = getDb();
  const booking = await getOwnBooking(input.organizationId, input.bookingId);
  try {
    await db
      .update(schema.booking)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(schema.booking.id, booking.id));
  } catch (err) {
    // Reactivar a `realizada` un instante que otra cita ya ocupa.
    if (isUniqueViolation(err)) {
      throw new BookingError("slot_taken", "Ese horario ya está ocupado");
    }
    throw err;
  }
  publish(input.organizationId, {
    type: "booking.updated",
    data: { bookingId: booking.id },
  });
}

/**
 * Edita lo que la cita ES —motivo, lugar/modalidad, notas, duración— sin mover
 * el instante. Para mover el instante está `rescheduleBooking`; separarlos es lo
 * que impide que corregir una nota re-valide el hueco y, de paso, lo pierda.
 *
 * La duración sí puede invadir a la cita que sigue (acortar nunca, alargar sí),
 * así que ese cambio vuelve por el mismo candado y chequeo de solape que la
 * inserción. Si el proveedor ya tiene la reunión, se le pasa la nueva duración:
 * es la MISMA reunión, más larga.
 */
export async function updateBooking(input: {
  organizationId: string;
  bookingId: string;
  title?: string | null;
  location?: string | null;
  notes?: string | null;
  durationMinutes?: number | null;
}): Promise<BookingResult> {
  const booking = await getOwnBooking(input.organizationId, input.bookingId);
  const settings = await getSettings(input.organizationId, booking.userId);
  const durationMinutes =
    input.durationMinutes === undefined || input.durationMinutes === null
      ? booking.durationMinutes
      : resolveDuration(input.durationMinutes, settings.slotMinutes);
  const longer = durationMinutes !== booking.durationMinutes;

  const values = {
    // `undefined` = no se tocó; `null` = se borró. Distintos, y el cliente
    // manda null explícito cuando limpia el campo.
    title:
      input.title === undefined ? booking.title : input.title?.trim() || null,
    location:
      input.location === undefined
        ? booking.location
        : input.location?.trim() || null,
    notes: input.notes === undefined ? booking.notes : input.notes?.trim() || null,
    durationMinutes,
    updatedAt: new Date(),
  };

  // Cambiar el asunto, el lugar o las notas también es un cambio que el
  // proveedor debe conocer: con Google el evento de calendario ES la reunión, y
  // sin ese PATCH el dueño se quedaría viendo el motivo viejo en su agenda.
  const contentChanged =
    values.title !== booking.title ||
    values.location !== booking.location ||
    values.notes !== booking.notes;

  let next: BookingRow;
  try {
    const updated = await getDb().transaction(async (tx) => {
      if (longer) {
        await lockBookingSlots(tx, input.organizationId);
        const endUtc = new Date(
          booking.scheduledAt.getTime() + durationMinutes * 60_000
        );
        if (
          await findSlotClash(tx, input.organizationId, {
            startUtc: booking.scheduledAt,
            endUtc,
            excludeBookingId: booking.id,
          })
        ) {
          return null;
        }
      }
      const rows = await tx
        .update(schema.booking)
        .set(values)
        .where(eq(schema.booking.id, booking.id))
        .returning();
      return rows[0]!;
    });
    if (!updated) {
      throw new BookingError(
        "slot_taken",
        "Esa duración chocaría con la cita que le sigue"
      );
    }
    next = updated;
  } catch (err) {
    if (err instanceof BookingError) throw err;
    if (isUniqueViolation(err)) {
      throw new BookingError("slot_taken", "Ese horario ya está ocupado");
    }
    throw err;
  }

  if (longer || contentChanged) {
    await withConnector(next, settings, async (conn, externalRef) => {
      await conn.updateMeeting(externalRef, {
        startUtc: next.scheduledAt.toISOString(),
        durationMinutes,
        timezone: settings.timezone,
        summary: await bookingSummary(input.organizationId, next),
        description: bookingDescription(next),
        location: next.location ?? undefined,
      });
    });
  }
  await syncBookingEvent(input.organizationId, next.id);

  publish(input.organizationId, {
    type: "booking.updated",
    data: { bookingId: next.id },
  });
  publishWebhook(input.organizationId, "booking.updated", {
    bookingId: next.id,
    contactId: next.contactId ?? null,
  });

  return {
    booking: next,
    meetingLink: next.meetingLink,
    linkPending: next.linkPending,
    label: labelInTz(next.scheduledAt.toISOString(), settings.timezone),
  };
}

/**
 * Reintenta la entrega de una cita que quedó sin enlace porque el proveedor
 * falló. Habla con el conector con el que NACIÓ la cita, no con el activo.
 *
 * Sin esto, un hipo del proveedor sería una pérdida silenciosa que nadie
 * repara — que es exactamente lo que pasa hoy en el fork.
 */
export async function retryMeetingLink(input: {
  organizationId: string;
  bookingId: string;
}): Promise<BookingResult> {
  const booking = await getOwnBooking(input.organizationId, input.bookingId);
  if (!booking.linkPending) {
    throw new BookingError("invalid", "Esta cita no tiene un enlace pendiente");
  }
  const settings = await getSettings(input.organizationId);
  const contactName = booking.contactId
    ? await getContactName(input.organizationId, booking.contactId)
    : "";
  const delivered = await deliverMeeting(booking, settings, contactName);

  publish(input.organizationId, {
    type: "booking.updated",
    data: { bookingId: delivered.id },
  });
  return {
    booking: delivered,
    meetingLink: delivered.meetingLink,
    linkPending: delivered.linkPending,
    label: labelInTz(delivered.scheduledAt.toISOString(), settings.timezone),
  };
}

/**
 * Crea la reunión en el proveedor y la guarda en la cita.
 *
 * SANDBOX: una cita del Laboratorio jamás llega a un conector. La aserción va
 * aquí, ANTES de resolver cuál es, para que valga igual para todos — hoy y
 * para el que agregue un fork mañana.
 */
async function deliverMeeting(
  booking: BookingRow,
  settings: CalendarSettings,
  contactName: string
): Promise<BookingRow> {
  if (booking.isTest) return booking;
  const connectorId = (booking.connector ?? settings.connector) as ConnectorId;

  try {
    const conn = await bindConnector(
      booking.organizationId,
      connectorId,
      settings
    );

    // Si la cita YA tiene reunión, esto es un reintento: se vuelve a leer, no
    // se crea otra. Sin esta rama, reintentar el enlace de un evento de Google
    // dejaría al dueño con dos citas en su calendario.
    const meeting =
      booking.externalRef && conn.refreshMeeting
        ? await conn.refreshMeeting(booking.externalRef)
        : await conn.createMeeting({
            topic: await bookingSummary(booking.organizationId, booking, contactName),
            startUtc: booking.scheduledAt.toISOString(),
            durationMinutes: booking.durationMinutes,
            timezone: settings.timezone,
            notes: booking.notes ?? undefined,
            location: booking.location ?? undefined,
          });

    const delivered = await persistDelivery(booking.id, {
      externalRef: meeting.externalId ?? booking.externalRef,
      meetingLink: meeting.joinUrl,
      // Un conector que promete enlace por cita y no lo trajo todavía deja la
      // cita "sin enlace" — reintentable. `enlace-fijo` sin sala configurada,
      // en cambio, no tiene nada pendiente: simplemente no hay enlace.
      linkPending: CONNECTOR_META[connectorId].perBookingLink && !meeting.joinUrl,
    });
    await syncBookingEvent(booking.organizationId, delivered.id);
    return delivered;
  } catch (err) {
    console.warn(
      `[agenda] el conector ${connectorId} no pudo entregar la reunión: ${err}`
    );
    if (err instanceof ConnectorError && err.isAuthError) {
      await markConnectorAuthError(booking.organizationId, connectorId).catch(
        () => {}
      );
    }
    // La cita ya existe y se queda: el enlace es lo único que falta. Se
    // conserva la referencia externa si ya la había, para que el reintento
    // sepa que no debe crear otra reunión.
    const delivered = await persistDelivery(booking.id, {
      externalRef: booking.externalRef,
      meetingLink: null,
      linkPending: true,
    });
    // Aquí también: con Google, el evento suele estar creado y lo que falta es
    // el enlace de Meet. Con otro conector, la cita existe y su evento del
    // calendario también debe existir — el cliente no puede quedarse sin aviso.
    await syncBookingEvent(booking.organizationId, delivered.id);
    return delivered;
  }
}

async function persistDelivery(
  bookingId: string,
  values: {
    externalRef: string | null;
    meetingLink: string | null;
    linkPending: boolean;
  }
): Promise<BookingRow> {
  const db = getDb();
  const rows = await db
    .update(schema.booking)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(schema.booking.id, bookingId))
    .returning();
  return rows[0]!;
}

/**
 * Corre un efecto sobre el proveedor de una cita ya creada (mover, borrar).
 * Best-effort y con el mismo guardarraíl de sandbox. Sin `external_ref` no hay
 * nada que mover: el conector no generó reunión (p. ej. el enlace fijo).
 */
async function withConnector(
  booking: BookingRow,
  settings: CalendarSettings,
  run: (
    conn: Awaited<ReturnType<typeof bindConnector>>,
    externalRef: string
  ) => Promise<void>
): Promise<void> {
  if (booking.isTest || !booking.externalRef) return;
  const connectorId = (booking.connector ?? settings.connector) as ConnectorId;
  try {
    const conn = await bindConnector(
      booking.organizationId,
      connectorId,
      settings
    );
    await run(conn, booking.externalRef);
  } catch (err) {
    console.warn(`[agenda] efecto en ${connectorId} falló: ${err}`);
    if (err instanceof ConnectorError && err.isAuthError) {
      await markConnectorAuthError(booking.organizationId, connectorId).catch(
        () => {}
      );
    }
  }
}

/**
 * Alternativas frescas para re-ofrecer. Si hay conversación, quedan
 * REGISTRADAS como su nueva oferta: el cliente puede aceptar una de inmediato
 * y la validación seguirá siendo válida.
 */
async function refreshOffer(
  organizationId: string,
  conversationId: string | null | undefined,
  opts: { now?: Date }
): Promise<OfferedSlot[]> {
  let fresh: AvailableSlot[] = [];
  try {
    fresh = (await computeAvailability(organizationId, { now: opts.now })).slice(
      0,
      FRESH_ALTERNATIVES
    );
  } catch (err) {
    console.warn(`[agenda] no pude calcular alternativas: ${err}`);
    return [];
  }
  const offers: OfferedSlot[] = fresh.map((s) => ({
    startUtc: s.startUtc,
    label: s.label,
  }));
  if (conversationId && offers.length > 0) {
    await replaceOffers(organizationId, conversationId, offers).catch((err) => {
      console.warn(`[agenda] no pude registrar la nueva oferta: ${err}`);
    });
  }
  return offers;
}

async function getOwnBooking(
  organizationId: string,
  bookingId: string
): Promise<BookingRow> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        eq(schema.booking.id, bookingId)
      )
    )
    .limit(1);
  if (!rows[0]) throw new BookingError("not_found", "Cita no encontrada");
  return rows[0];
}

async function getContactName(
  organizationId: string,
  contactId: string
): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ name: schema.contact.name })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, contactId)
      )
    )
    .limit(1);
  return rows[0]?.name ?? "";
}

/**
 * Como `getContactName`, pero el desconocido es un error: se usa donde el
 * contactId llegó del cliente y no podemos crear un registro apuntando a un
 * contacto inexistente o de otra organización.
 */
async function requireContactName(
  organizationId: string,
  contactId: string
): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ name: schema.contact.name })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, contactId)
      )
    )
    .limit(1);
  if (!rows[0]) {
    throw new BookingError("not_found", "Contacto no encontrado");
  }
  return rows[0].name;
}

/**
 * El lead avanza a la siguiente etapa abierta al agendar — solo hacia adelante,
 * nunca retrocede.
 *
 * Pasa por `moveLeadToStage`, la única puerta que puede escribir `stage_id`:
 * mover el lead y registrar el movimiento en la bitácora son la misma
 * operación. Escribir el UPDATE aquí no truena, solo hace que las gráficas
 * mientan meses después — y hay un test de vigilancia que lo impide.
 */
async function advanceLeadStage(
  organizationId: string,
  contactId: string,
  source: "bot" | "dueno"
): Promise<void> {
  const db = getDb();
  const leads = await db
    .select({ id: schema.lead.id, stageId: schema.lead.stageId })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .orderBy(desc(schema.lead.isPrimary), descNullsLast(schema.lead.lastActivityAt))
    .limit(1);
  const lead = leads[0];
  if (!lead) return;

  const stages = await db
    .select({
      id: schema.pipelineStage.id,
      position: schema.pipelineStage.position,
      kind: schema.pipelineStage.kind,
    })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const currentIdx = stages.findIndex((s) => s.id === lead.stageId);
  if (currentIdx < 0) return;
  const nextOpen = stages.find((s, i) => i > currentIdx && s.kind === "open");
  if (!nextOpen) return; // ya está en la última etapa abierta (o en un ancla)

  await moveLeadToStage({
    organizationId,
    leadId: lead.id,
    toStageId: nextOpen.id,
    source,
    extra: { lastActivityAt: new Date() },
  });
}

/** Citas que ocupan agenda de verdad. */
export const ACTIVE_STATUSES = ["agendada", "realizada"] as const;

/** ¿Hay alguna cita activa para este contacto? Lo usa el agente. */
export async function hasActiveBooking(
  organizationId: string,
  contactId: string,
  now = new Date()
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.booking.id })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        and(
          eq(schema.booking.contactId, contactId),
          eq(schema.booking.kind, "session"),
          inArray(schema.booking.status, [...ACTIVE_STATUSES]),
          gte(schema.booking.scheduledAt, now)
        )
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * La duración pedida, siempre dentro de lo que la pantalla puede escribir
 * (5 min..10 h). `undefined` o un valor basura = la rejilla configurada, que es
 * exactamente lo que hacían estas rutas antes.
 */
function resolveDuration(
  requested: number | undefined | null,
  slotMinutes: number
): number {
  if (requested === undefined || requested === null || !Number.isFinite(requested)) {
    return slotMinutes;
  }
  return Math.max(5, Math.min(600, Math.round(requested)));
}

/** 23505 = unique_violation de Postgres. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === "23505") return true;
  // Drizzle envuelve el error del driver: el código real viaja en `cause`.
  const cause = (err as { cause?: unknown }).cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { code?: unknown }).code === "23505"
  );
}
