/**
 * Quotes Service — lógica de negocio del cotizador.
 *
 * Cotizaciones versionadas con partidas, descuentos, impuestos, vigencia.
 * PDF con marca LUMARK y envío por WhatsApp/Instagram/Messenger.
 */
import { eq, and, desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

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
  paymentMethod?: Record<string, unknown>;
};

/** Generar número de cotización secuencial */
async function nextQuoteNumber(organizationId: string): Promise<string> {
  const db = getDb();
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
  const db = getDb();
  const id = newId("quote");
  const quoteNumber = await nextQuoteNumber(organizationId);
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
    paymentMethod: input.paymentMethod ?? null,
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

  return id;
}

/** Actualizar una cotización (solo si está en draft) */
export async function updateQuote(
  organizationId: string,
  quoteId: string,
  input: QuoteInput
): Promise<void> {
  const db = getDb();

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
    .limit(1);

  const quote = rows[0];
  if (!quote) throw new Error("Cotización no encontrada");
  if (quote.status !== "draft") throw new Error("Solo se pueden editar cotizaciones en borrador");

  const totals = calculateTotals(input.items, {
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
      paymentMethod: input.paymentMethod ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.quote.id, quoteId));

  // Eliminar partidas viejas y crear nuevas
  await db.delete(schema.quoteItem).where(eq(schema.quoteItem.quoteId, quoteId));

  for (const [i, item] of input.items.entries()) {
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
}

/** Enviar cotización (cambia status a sent, congelando la versión) */
export async function sendQuote(
  organizationId: string,
  quoteId: string,
  channel: "whatsapp" | "instagram" | "messenger"
): Promise<{ waMessageId?: string; total: number }> {
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
  if (!quote) throw new Error("Cotización no encontrada");

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

  return { total: quote.total };
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

  return { ...quote, items };
}

/** Listar cotizaciones de una organización */
export async function listQuotes(
  organizationId: string,
  opts?: { status?: string; limit?: number; offset?: number }
) {
  const db = getDb();
  const conditions = [scoped(schema.quote.organizationId, organizationId)];
  if (opts?.status) {
    conditions.push(eq(schema.quote.status, opts.status));
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
