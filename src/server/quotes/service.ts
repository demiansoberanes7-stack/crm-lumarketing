/**
 * Quotes Service — lógica de negocio del cotizador.
 *
 * Cotizaciones versionadas con partidas, descuentos, impuestos, vigencia.
 * PDF con marca LUMARK y envío por WhatsApp/Instagram/Messenger.
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { publishWebhook } from "@/server/webhooks/dispatcher";

export type QuoteStatus =
  | "draft"
  | "unsaved"
  | "saved"
  | "sent"
  | "viewed"
  | "accepted"
  | "rejected"
  | "expired"
  | "cancelled";

export type QuoteInput = {
  contactId?: string | null;
  items: Array<{
    productId?: string | null;
    name: string;
    description?: string;
    quantity: number;
    unitPrice: number;
  }>;
  discountType?: "fixed" | "percentage" | null;
  discountValue?: number | null;
  taxRate?: number;
  validDays?: number;
  notes?: string;
  paymentConditions?: string;
  paymentMethod?: Record<string, unknown>;
};

/** Generar número de cotización secuencial (usa el db del transaction para evitar race condition) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nextQuoteNumber(db: any, organizationId: string): Promise<string> {
  const last = await db
    .select({ quoteNumber: schema.quote.quoteNumber })
    .from(schema.quote)
    .where(scoped(schema.quote.organizationId, organizationId))
    .orderBy(desc(schema.quote.createdAt))
    .limit(1);

  if (last[0]) {
    const num = parseInt(last[0].quoteNumber.replace("COT-", ""), 10);
    if (!isNaN(num)) {
      return `COT-${String(num + 1).padStart(4, "0")}`;
    }
  }
  return "COT-0001";
}

/** Calcular totales de una cotización */
function calculateTotals(items: QuoteInput["items"], input: {
  discountType?: "fixed" | "percentage" | null;
  discountValue?: number | null;
  taxRate?: number;
}): { subtotal: number; discountAmount: number; taxAmount: number; total: number } {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  if (input.discountType === "percentage" && (input.discountValue ?? 0) > 100) throw new Error("El descuento no puede superar el 100%");
  if (!Number.isSafeInteger(subtotal) || subtotal > 1800000000) throw new Error("Importe fuera de rango");

  let discountAmount = 0;
  if (input.discountType === "fixed" && input.discountValue) {
    discountAmount = Math.min(input.discountValue, subtotal);
  } else if (input.discountType === "percentage" && input.discountValue) {
    discountAmount = Math.round((subtotal * input.discountValue) / 100);
  }

  const afterDiscount = subtotal - discountAmount;
  const taxRate = input.taxRate ?? 16;
  const taxAmount = Math.round((afterDiscount * taxRate) / 100);
  const total = afterDiscount + taxAmount;

  return { subtotal, discountAmount, taxAmount, total };
}

/** Crear una cotización nueva */
export async function createQuote(
  organizationId: string,
  input: QuoteInput,
  createdBy?: string
): Promise<string> {
  return getDb().transaction(async (db) => {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${organizationId + ':quotes'}))`);
  if (input.contactId) {
    const [contact] = await db.select({ id: schema.contact.id }).from(schema.contact).where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, input.contactId)));
    if (!contact) throw new Error("Contacto no válido");
  }
  const id = newId("quote");
  const quoteNumber = await nextQuoteNumber(db, organizationId);
  const totals = calculateTotals(input.items, {
    discountType: input.discountType,
    discountValue: input.discountValue,
    taxRate: input.taxRate,
  });

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (input.validDays ?? 30));

  await db.insert(schema.quote).values({
    id,
    organizationId,
    quoteNumber,
    contactId: input.contactId ?? null,
    status: "draft",
    currency: "MXN",
    validUntil,
    subtotal: totals.subtotal,
    discountType: input.discountType ?? null,
    discountValue: input.discountValue ?? null,
    discountAmount: totals.discountAmount,
    taxRate: input.taxRate ?? 16,
    taxAmount: totals.taxAmount,
    total: totals.total,
    paymentMethod: input.paymentConditions
      ? { ...(input.paymentMethod ?? {}), conditions: input.paymentConditions }
      : input.paymentMethod ?? null,
    message: input.notes ?? null,
    version: 1,
    createdBy: createdBy ?? null,
  });

  // Insertar partidas
  for (const [i, item] of input.items.entries()) {
    await db.insert(schema.quoteItem).values({
      id: newId("quoteItem"),
      quoteId: id,
      productId: item.productId ?? null,
      name: item.name,
      description: item.description ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      currency: "MXN",
      position: i,
    });
  }

  // Registrar evento
  await db.insert(schema.quoteEvent).values({
    id: newId("quoteEvent"),
    organizationId,
    quoteId: id,
    eventType: "created",
    actorId: createdBy ?? null,
  });

  publishWebhook(organizationId, "quote.created", {
    quoteId: id,
    quoteNumber: quoteNumber,
    total: totals.total,
    contactId: input.contactId ?? null,
  });

  return id;
  });
}

/** Actualizar una cotización (solo si está en draft) */
export async function updateQuote(
  organizationId: string,
  quoteId: string,
  input: Partial<QuoteInput>
): Promise<void> {
  return getDb().transaction(async (db) => {
  if (input.contactId) {
    const [contact] = await db.select({ id: schema.contact.id }).from(schema.contact).where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, input.contactId)));
    if (!contact) throw new Error("Contacto no válido");
  }
  // Verificar que existe y está en draft
  const rows = await db
    .select()
    .from(schema.quote)
    .where(
      scoped(
        schema.quote.organizationId,
        organizationId,
        eq(schema.quote.id, quoteId)
      )
    )
    .limit(1).for("update");

  const quote = rows[0];
  if (!quote) throw new Error("Cotización no encontrada");
  if (quote.status !== "draft") throw new Error("Solo se pueden editar cotizaciones en borrador");
  const previous = await getQuote(organizationId, quoteId);
  input = { contactId: quote.contactId, items: previous!.items.map((item) => ({ ...item, description: item.description ?? undefined })), discountType: quote.discountType as QuoteInput["discountType"], discountValue: quote.discountValue, taxRate: quote.taxRate, ...input };

  const totals = calculateTotals(input.items!, {
    discountType: input.discountType,
    discountValue: input.discountValue,
    taxRate: input.taxRate,
  });

  await db
    .update(schema.quote)
    .set({
      contactId: input.contactId ?? null,
      subtotal: totals.subtotal,
      discountType: input.discountType ?? null,
      discountValue: input.discountValue ?? null,
      discountAmount: totals.discountAmount,
      taxRate: input.taxRate ?? 16,
      taxAmount: totals.taxAmount,
      total: totals.total,
      paymentMethod: input.paymentConditions
        ? { ...(quote.paymentMethod as Record<string, unknown> ?? {}), ...(input.paymentMethod ?? {}), conditions: input.paymentConditions }
        : input.paymentMethod ?? quote.paymentMethod ?? null,
      message: input.notes ?? quote.message,
      validUntil: input.validDays ? new Date(Date.now() + input.validDays * 86400000) : quote.validUntil,
      updatedAt: new Date(),
    })
    .where(eq(schema.quote.id, quoteId));

  // Eliminar partidas viejas y crear nuevas
  await db.delete(schema.quoteItem).where(eq(schema.quoteItem.quoteId, quoteId));

  for (const [i, item] of input.items!.entries()) {
    await db.insert(schema.quoteItem).values({
      id: newId("quoteItem"),
      quoteId,
      productId: item.productId ?? null,
      name: item.name,
      description: item.description ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      currency: "MXN",
      position: i,
    });
  }
  });
}

/** Enviar cotización (cambia status a sent, congelando la versión) */
export async function sendQuote(
  organizationId: string,
  quoteId: string,
  channel: "whatsapp" | "instagram" | "messenger"
): Promise<{ waMessageId?: string; total: number }> {
  return getDb().transaction(async (db) => {

  const rows = await db
    .select()
    .from(schema.quote)
    .where(
      scoped(
        schema.quote.organizationId,
        organizationId,
        eq(schema.quote.id, quoteId)
      )
    )
    .limit(1).for("update");

  const quote = rows[0];
  if (!quote) throw new Error("Cotización no encontrada");
  if (quote.status !== "draft") throw new Error("Esta cotización ya no es un borrador");
  if (!quote.contactId) throw new Error("Asigna un contacto antes de enviar");
  const [conversation] = await db.select().from(schema.conversation).where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.contactId, quote.contactId), eq(schema.conversation.channel, channel), eq(schema.conversation.isTest, false))).limit(1);
  if (!conversation) throw new Error("El contacto no tiene una conversación real en este canal");
  const { sendMediaMessage, sendText } = await import("@/server/inbox/send");
  if (channel === "whatsapp") {
    const { quotePdf } = await import("./pdf");
    const pdf = await quotePdf(organizationId, quoteId);
    if (!pdf) throw new Error("No se pudo generar el PDF de la cotización");
    await sendMediaMessage({ organizationId, conversationId: conversation.id, file: { data: Buffer.from(pdf.bytes), mimeType: "application/pdf", fileName: pdf.filename } });
  } else {
    const full = await getQuote(organizationId, quoteId);
    if (!full) throw new Error("Cotización no encontrada");
    const { money } = await import("@/server/documents/pdf");
    await sendText({ organizationId, conversationId: conversation.id, text: [`Cotización ${quote.quoteNumber}`, ...full.items.map((item) => `${item.quantity} x ${item.name}: ${money(item.unitPrice * item.quantity)}`), `Subtotal: ${money(quote.subtotal)}`, `Descuento: ${money(quote.discountAmount)}`, `IVA: ${money(quote.taxAmount)}`, `Total: ${money(quote.total)} MXN`, `Vigencia: ${quote.validUntil?.toLocaleDateString("es-MX") ?? "Sin fecha"}`, quote.message ?? ""].join("\n") });
  }

  await db
    .update(schema.quote)
    .set({
      status: "sent",
      sendChannel: channel,
      lockedAt: new Date(),
      version: quote.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(schema.quote.id, quoteId));

  await db.insert(schema.quoteEvent).values({
    id: newId("quoteEvent"),
    organizationId,
    quoteId,
    eventType: "sent",
    channel,
  });

  publishWebhook(organizationId, "quote.sent", {
    quoteId,
    quoteNumber: quote.quoteNumber,
    total: quote.total,
    channel,
  });

  return { total: quote.total };
  });
}

/** Obtener una cotización con sus items */
export async function getQuote(organizationId: string, quoteId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.quote)
    .where(
      scoped(
        schema.quote.organizationId,
        organizationId,
        eq(schema.quote.id, quoteId)
      )
    )
    .limit(1);

  const quote = rows[0];
  if (!quote) return null;

  const items = await db
    .select()
    .from(schema.quoteItem)
    .where(eq(schema.quoteItem.quoteId, quoteId))
    .orderBy(schema.quoteItem.position);

  const [contact] = quote.contactId ? await db.select({ name: schema.contact.name, phone: schema.contact.phone, ficha: schema.contact.ficha }).from(schema.contact).where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, quote.contactId))) : [];
  const contactEmail = contact?.ficha && typeof contact.ficha === "object" ? (contact.ficha as Record<string, unknown>).email as string ?? null : null;
  return { ...quote, items, contactName: contact?.name ?? null, contactPhone: contact?.phone ?? null, contactEmail };
}

/** Cambiar estado de una cotización (accepted / rejected) */
export async function changeQuoteStatus(
  organizationId: string,
  quoteId: string,
  newStatus: "accepted" | "rejected"
): Promise<void> {
  return getDb().transaction(async (db) => {
    const rows = await db
      .select()
      .from(schema.quote)
      .where(
        scoped(
          schema.quote.organizationId,
          organizationId,
          eq(schema.quote.id, quoteId)
        )
      )
      .limit(1).for("update");

    const quote = rows[0];
    if (!quote) throw new Error("Cotización no encontrada");
    if (!["draft", "sent", "viewed"].includes(quote.status))
      throw new Error("Solo se pueden aprobar o rechazar cotizaciones en borrador, enviadas o vistas");

    await db
      .update(schema.quote)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(schema.quote.id, quoteId));

    await db.insert(schema.quoteEvent).values({
      id: newId("quoteEvent"),
      organizationId,
      quoteId,
      eventType: newStatus,
    });

    publishWebhook(organizationId, newStatus === "accepted" ? "quote.accepted" : "quote.rejected", {
      quoteId,
      quoteNumber: quote.quoteNumber,
      status: newStatus,
    });
  });
}

/** Listar cotizaciones de una organización */
export async function listQuotes(
  organizationId: string,
  opts?: { status?: string; limit?: number; offset?: number; archived?: boolean }
) {
  const db = getDb();
  const conditions = [scoped(schema.quote.organizationId, organizationId)];
  if (opts?.status) {
    conditions.push(eq(schema.quote.status, opts.status));
  }
  if (opts?.archived) {
    conditions.push(sql`${schema.quote.archivedAt} IS NOT NULL`);
  } else {
    conditions.push(sql`${schema.quote.archivedAt} IS NULL`);
  }

  const rows = await db
    .select()
    .from(schema.quote)
    .where(and(...conditions))
    .orderBy(desc(schema.quote.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);

  return rows;
}

/** Archivar una cotización */
export async function archiveQuote(
  organizationId: string,
  quoteId: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.quote)
    .where(
      scoped(
        schema.quote.organizationId,
        organizationId,
        eq(schema.quote.id, quoteId)
      )
    )
    .limit(1);

  if (!rows[0]) throw new Error("Cotización no encontrada");

  await db
    .update(schema.quote)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.quote.id, quoteId));
}

/** Restaurar una cotización archivada */
export async function unarchiveQuote(
  organizationId: string,
  quoteId: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.quote)
    .where(
      scoped(
        schema.quote.organizationId,
        organizationId,
        eq(schema.quote.id, quoteId)
      )
    )
    .limit(1);

  if (!rows[0]) throw new Error("Cotización no encontrada");

  await db
    .update(schema.quote)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(schema.quote.id, quoteId));
}

/** Eliminar una cotización (solo archivadas) */
export async function deleteQuote(
  organizationId: string,
  quoteId: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.quote)
    .where(
      scoped(
        schema.quote.organizationId,
        organizationId,
        eq(schema.quote.id, quoteId)
      )
    )
    .limit(1);

  if (!rows[0]) throw new Error("Cotización no encontrada");
  if (!rows[0].archivedAt) throw new Error("Solo se pueden eliminar cotizaciones archivadas");

  await db.delete(schema.quoteItem).where(eq(schema.quoteItem.quoteId, quoteId));
  await db.delete(schema.quoteEvent).where(eq(schema.quoteEvent.quoteId, quoteId));
  await db.delete(schema.quote).where(eq(schema.quote.id, quoteId));
}
