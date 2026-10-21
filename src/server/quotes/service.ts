/**
 * Quotes Service — lógica de negocio del cotizador.
 *
 * Cotizaciones versionadas con partidas, descuentos, impuestos, vigencia.
 * PDF con marca Zorro Tech y envío por WhatsApp/Instagram/Messenger o,
 * respondiendo dentro de su hilo, por correo.
 */
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { publishWebhook } from "@/server/webhooks/dispatcher";
import { emailParticipantOf, sendEmail } from "@/server/email/service";
import { acceptQuoteIntoProjectTx } from "@/server/projects/from-quote";
import { syncTaskById } from "@/server/agenda/tasks-sync";
import { quotePdfFileName } from "./filename";

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
  /** Teléfono impreso en la cotización; si falta, se usa el del contacto. */
  clientPhone?: string | null;
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

/**
 * Valida que los productId existan EN ESTA organización y que el stock vigente
 * alcance para la cantidad pedida (null = sin control, no valida).
 * Se usa en createQuote, updateQuote y changeQuoteStatus: sin la tercera
 * llamada, aprobar una cotización vieja sobre un stock que ya bajó permitía
 * overselling silencioso (GREATEST(...,0) tapaba el déficit).
 */
/** Tx dentro de getDb().transaction(...) — el helper corre SIEMPRE dentro de una. */
type QuoteTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function assertStockAvailable(
  db: QuoteTx,
  organizationId: string,
  items: QuoteInput["items"]
): Promise<void> {
  const productIds = [...new Set(items.map((i) => i.productId).filter((id): id is string => Boolean(id)))];
  if (!productIds.length) return;
  const stocks = await db
    .select({ id: schema.catalogProduct.id, name: schema.catalogProduct.name, stock: schema.catalogProduct.stock })
    .from(schema.catalogProduct)
    .where(scoped(schema.catalogProduct.organizationId, organizationId, inArray(schema.catalogProduct.id, productIds)))
    .for("share");
  const byId = new Map(stocks.map((row) => [row.id, row]));
  for (const item of items) {
    if (!item.productId) continue;
    const product = byId.get(item.productId);
    if (!product) throw new Error("Producto no válido");
    if (product.stock === null || product.stock === undefined) continue;
    if (item.quantity > product.stock) {
      throw new Error(
        `Inventario insuficiente para "${product.name}": ${product.stock === 0 ? "está agotado" : `quedan ${product.stock} pieza${product.stock === 1 ? "" : "s"}`}.`
      );
    }
  }
}

/**
 * El teléfono tal y como se escribió, pero sin basura: lo que entra del chat o
 * del teclado del operador viene con paréntesis, guiones y espacios sueltos.
 * Se aceptan dígitos, `+` inicial, `-`, `.` y espacios; el resto se descarta.
 */
export function normalizeClientPhone(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? "").replace(/[^\d+\-.\s]/g, "").replace(/\s+/g, " ").trim();
  if (cleaned.replace(/\D/g, "").length < 6) return null;
  return cleaned.slice(0, 32);
}

/** Crear una cotización nueva */
export async function createQuote(
  organizationId: string,
  input: QuoteInput,
  createdBy?: string,
  options?: { agentSourceMessageId?: string }
): Promise<string> {
  const created = await getDb().transaction(async (db) => {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${organizationId + ':quotes'}))`);
  if (options?.agentSourceMessageId) {
    const [existingEvent] = await db
      .select({ quoteId: schema.quoteEvent.quoteId })
      .from(schema.quoteEvent)
      .where(scoped(
        schema.quoteEvent.organizationId,
        organizationId,
        eq(schema.quoteEvent.eventType, "created"),
        sql`${schema.quoteEvent.metadata}->>'agentSourceMessageId' = ${options.agentSourceMessageId}`
      ))
      .limit(1);
    if (existingEvent) {
      const [existingQuote] = await db
        .select({ id: schema.quote.id, quoteNumber: schema.quote.quoteNumber, total: schema.quote.total, contactId: schema.quote.contactId })
        .from(schema.quote)
        .where(scoped(schema.quote.organizationId, organizationId, eq(schema.quote.id, existingEvent.quoteId)))
        .limit(1);
      if (existingQuote) return { ...existingQuote, created: false };
    }
  }
  if (input.contactId) {
    const [contact] = await db.select({ id: schema.contact.id }).from(schema.contact).where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, input.contactId)));
    if (!contact) throw new Error("Contacto no válido");
  }
  // Inventario: contra el stock vigente. null = sin control (no valida).
  await assertStockAvailable(db, organizationId, input.items);
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
    clientPhone: normalizeClientPhone(input.clientPhone),
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
      organizationId,
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
    metadata: options?.agentSourceMessageId
      ? { agentSourceMessageId: options.agentSourceMessageId }
      : null,
  });

  return { id, quoteNumber, total: totals.total, contactId: input.contactId ?? null, created: true };
  });

  if (created.created) {
    publishWebhook(organizationId, "quote.created", {
      quoteId: created.id,
      quoteNumber: created.quoteNumber,
      total: created.total,
      contactId: created.contactId,
    });
  }

  return created.id;
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

  // Aislamiento: los productId de las partidas nuevas tienen que existir en
  // ESTA organización, y el stock vigente tiene que alcanzar — sin esto, un
  // draft con qty 1 se editaba a qty 100 y se aprobaba directo al clamp.
  await assertStockAvailable(db, organizationId, input.items ?? []);

  const totals = calculateTotals(input.items!, {
    discountType: input.discountType,
    discountValue: input.discountValue,
    taxRate: input.taxRate,
  });

  await db
    .update(schema.quote)
    .set({
      contactId: input.contactId ?? null,
      clientPhone:
        input.clientPhone === undefined ? quote.clientPhone : normalizeClientPhone(input.clientPhone),
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
      organizationId,
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

/** Canales de chat que admiten una cotización; el correo va aparte. */
export type QuoteChatChannel = "whatsapp" | "instagram" | "messenger";

/**
 * Destino del envío: un chat de la Bandeja (053: elegido por el operador o
 * resuelto por el contacto) o un hilo del buzón de correo, identificado por el
 * mensaje al que se responde.
 */
export type QuoteSendTarget =
  | { channel: QuoteChatChannel; conversationId?: string }
  | { channel: "email"; emailAccountId: string; emailMessageId: string };

/** Resumen de la cotización en texto: cuerpo del correo y degradado de chat. */
async function quoteSummaryLines(
  organizationId: string,
  quote: typeof schema.quote.$inferSelect
): Promise<string[]> {
  const full = await getQuote(organizationId, quote.id);
  if (!full) throw new Error("Cotización no encontrada");
  const { money } = await import("@/server/documents/pdf");
  return [
    `Cotización ${quote.quoteNumber}`,
    ...full.items.map((item) => `${item.quantity} x ${item.name}: ${money(item.unitPrice * item.quantity)}`),
    `Subtotal: ${money(quote.subtotal)}`,
    `Descuento: ${money(quote.discountAmount)}`,
    `IVA: ${money(quote.taxAmount)}`,
    `Total: ${money(quote.total)} MXN`,
    `Vigencia: ${quote.validUntil?.toLocaleDateString("es-MX") ?? "Sin fecha"}`,
    ...(quote.message ? [quote.message] : []),
  ];
}

/**
 * Envía el PDF de la cotización respondiendo dentro del hilo del buzón. El
 * destinatario lo dicta el propio hilo (nunca una dirección tecleada) y el
 * asunto hereda el "Re:" para que el cliente lo vea en su conversación.
 */
async function sendQuoteByEmail(
  db: QuoteTx,
  organizationId: string,
  quote: typeof schema.quote.$inferSelect,
  target: { emailAccountId: string; emailMessageId: string },
  productName: string
): Promise<void> {
  const [account] = await db
    .select({ emailAddress: schema.emailAccount.emailAddress })
    .from(schema.emailAccount)
    .where(scoped(schema.emailAccount.organizationId, organizationId, eq(schema.emailAccount.id, target.emailAccountId)))
    .limit(1);
  if (!account) throw new Error("La cuenta de correo no pertenece a tu negocio");

  const [anchor] = await db
    .select()
    .from(schema.emailMessage)
    .where(scoped(schema.emailMessage.organizationId, organizationId, eq(schema.emailMessage.id, target.emailMessageId), eq(schema.emailMessage.accountId, target.emailAccountId)))
    .limit(1);
  if (!anchor) throw new Error("El hilo de correo no existe en esta cuenta");

  const participant = emailParticipantOf(anchor, account.emailAddress);
  if (!participant.email) {
    throw new Error("Este hilo de correo no tiene una dirección del cliente a la que responder");
  }

  const [contactRow] = quote.contactId
    ? await db.select({ name: schema.contact.name }).from(schema.contact)
        .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, quote.contactId))).limit(1)
    : [];
  const contactName = contactRow?.name?.trim() || participant.name || quote.quoteNumber;

  const { quotePdf } = await import("./pdf");
  const pdf = await quotePdf(organizationId, quote.id);
  if (!pdf) throw new Error("No se pudo generar el PDF de la cotización");

  const lines = await quoteSummaryLines(organizationId, quote);
  await sendEmail(organizationId, target.emailAccountId, {
    to: participant.email,
    subject: /^re:\s/i.test(anchor.subject ?? "")
      ? (anchor.subject ?? "Cotización")
      : `Re: ${anchor.subject ?? "Cotización"}`,
    text: [
      `Hola ${contactName}, te envío la cotización ${quote.quoteNumber}. Adjunto el PDF con el detalle.`,
      "",
      ...lines,
    ].join("\n"),
    inReplyTo: anchor.messageId,
    contactId: quote.contactId,
    attachments: [
      {
        filename: quotePdfFileName(productName, contactName),
        content: Buffer.from(pdf.bytes).toString("base64"),
        contentType: "application/pdf",
      },
    ],
  });
}

/** Enviar cotización (cambia status a sent, congelando la versión) */
export async function sendQuote(
  organizationId: string,
  quoteId: string,
  target: QuoteSendTarget,
  options?: { humanAgentTagAllowed?: boolean }
): Promise<{ waMessageId?: string; total: number }> {
  const channel = target.channel;
  const sent = await getDb().transaction(async (db) => {

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

  const [firstItem] = await db
    .select({ name: schema.quoteItem.name })
    .from(schema.quoteItem)
    .where(scoped(schema.quoteItem.organizationId, organizationId, eq(schema.quoteItem.quoteId, quoteId)))
    .orderBy(schema.quoteItem.position)
    .limit(1);
  const productName = firstItem?.name?.trim() || quote.quoteNumber;

  // El contacto que queda registrado en la cotización: el del chat usado o,
  // en correo, el que ya traía (los hilos de correo no tienen contacto).
  let sentContactId = quote.contactId;

  if (channel === "email") {
    await sendQuoteByEmail(db, organizationId, quote, {
      emailAccountId: target.emailAccountId,
      emailMessageId: target.emailMessageId,
    }, productName);
  } else {
    // Resolver el chat de destino: el elegido explícitamente (y sólo si es del
    // canal pedido), o el del contacto de la cotización como hasta ahora.
    let conversation;
    if (target.conversationId) {
      const [picked] = await db.select().from(schema.conversation).where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, target.conversationId), eq(schema.conversation.channel, channel), eq(schema.conversation.isTest, false))).limit(1);
      if (!picked) throw new Error("Ese chat no existe en este canal");
      conversation = picked;
    } else {
      if (!quote.contactId) throw new Error("Asigna un contacto antes de enviar");
      const [byContact] = await db.select().from(schema.conversation).where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.contactId, quote.contactId), eq(schema.conversation.channel, channel), eq(schema.conversation.isTest, false))).limit(1);
      if (!byContact) throw new Error("El contacto no tiene una conversación real en este canal");
      conversation = byContact;
    }
    sentContactId = conversation.contactId;
    const { sendMediaMessage, sendText } = await import("@/server/inbox/send");
    const { capabilitiesFor } = await import("@/server/channels/capabilities");
    // El PDF sale como adjunto en todo canal que lo admita (WhatsApp, Messenger).
    // Instagram no soporta outboundMedia, así que ahí degrada a resumen en texto.
    if (capabilitiesFor(channel).outboundMedia) {
      const { quotePdf } = await import("./pdf");
      const pdf = await quotePdf(organizationId, quoteId);
      if (!pdf) throw new Error("No se pudo generar el PDF de la cotización");
      // El archivo que llega al chat se nombra por el destinatario, no por el
      // número interno: "Cotizacion <producto> - <cliente>".
      const targetContactId = conversation.contactId ?? quote.contactId;
      const [contactRow] = targetContactId
        ? await db.select({ name: schema.contact.name }).from(schema.contact).where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, targetContactId))).limit(1)
        : [];
      const contactName = contactRow?.name?.trim() || quote.quoteNumber;
      await sendMediaMessage({ organizationId, conversationId: conversation.id, file: { data: Buffer.from(pdf.bytes), mimeType: "application/pdf", fileName: quotePdfFileName(productName, contactName) }, humanAgentTagAllowed: options?.humanAgentTagAllowed === true });
    } else {
      const lines = await quoteSummaryLines(organizationId, quote);
      await sendText({ organizationId, conversationId: conversation.id, text: lines.join("\n"), humanAgentTagAllowed: options?.humanAgentTagAllowed === true });
    }
  }

  await db
    .update(schema.quote)
    .set({
      status: "sent",
      sendChannel: channel,
      // La cotización queda ligada al chat por el que salió: la siguiente
      // edición/reeenvío parte de ese contacto y no de uno adivinado.
      contactId: sentContactId,
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

  return { total: quote.total, quoteNumber: quote.quoteNumber };
  });

  publishWebhook(organizationId, "quote.sent", {
    quoteId,
    quoteNumber: sent.quoteNumber,
    total: sent.total,
    channel,
  });

  return { total: sent.total };
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
    .select({
      item: schema.quoteItem,
      // Descripción larga del catálogo: el PDF la imprime en letra chica
      // debajo de cada partida. Sin join sería un segundo query por ítem.
      longDescription: schema.catalogProduct.longDescription,
    })
    .from(schema.quoteItem)
    .leftJoin(
      schema.catalogProduct,
      and(
        eq(schema.quoteItem.productId, schema.catalogProduct.id),
        // Tenant en el join: un producto de OTRA organización no puede filtrar
        // su descripción larga en la API/PDF de esta.
        eq(schema.catalogProduct.organizationId, organizationId)
      )
    )
    .where(eq(schema.quoteItem.quoteId, quoteId))
    .orderBy(schema.quoteItem.position);

  const [contact] = quote.contactId ? await db.select({ name: schema.contact.name, phone: schema.contact.phone, ficha: schema.contact.ficha }).from(schema.contact).where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, quote.contactId))) : [];
  const contactEmail = contact?.ficha && typeof contact.ficha === "object" ? (contact.ficha as Record<string, unknown>).email as string ?? null : null;
  return {
    ...quote,
    items: items.map(({ item, longDescription }) => ({
      ...item,
      longDescription: longDescription ?? null,
    })),
    contactName: contact?.name ?? null,
    // El de la cotización manda: es el número que el operador escribió para
    // ESTE cliente; el del contacto es solo el respaldo.
    contactPhone: quote.clientPhone ?? contact?.phone ?? null,
    contactEmail,
  };
}

/** Cambiar estado de una cotización (accepted / rejected) */
export async function changeQuoteStatus(
  organizationId: string,
  quoteId: string,
  newStatus: "accepted" | "rejected",
  opts?: { actorUserId?: string | null }
): Promise<void> {
  const done = await getDb().transaction(async (db) => {
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

    // Al ACEPTAR se descuenta el inventario de los productos vinculados, una
    // sola vez: el guard de transición de arriba impide repetir el descuento
    // (solo se puede pasar a accepted desde draft/sent/viewed). Los productos
    // sin stock controlado (null) se quedan como están.
    if (newStatus === "accepted") {
      const items = await db
        .select({ productId: schema.quoteItem.productId, quantity: schema.quoteItem.quantity })
        .from(schema.quoteItem)
        .where(scoped(schema.quoteItem.organizationId, organizationId, eq(schema.quoteItem.quoteId, quoteId)));
      for (const item of items) {
        if (!item.productId) continue;
        // Re-validar el stock VIGENTE dentro de la misma transacción: entre
        // crear la cotización y aprobarla pudo bajar (otra aprobación, un
        // PATCH del catálogo, un import CSV). FOR UPDATE serializa contra
        // aprobaciones concurrentes del mismo producto. GREATEST(...,0) solo
        // es defensa, no regla de negocio: si enmascarara un déficit aquí,
        // venderíamos más piezas de las que hay sin avisar.
        const [product] = await db
          .select({ name: schema.catalogProduct.name, stock: schema.catalogProduct.stock })
          .from(schema.catalogProduct)
          .where(
            scoped(schema.catalogProduct.organizationId, organizationId, eq(schema.catalogProduct.id, item.productId))
          )
          .limit(1)
          .for("update");
        if (product && product.stock !== null && product.stock < item.quantity) {
          throw new Error(
            `Inventario insuficiente para «${product.name}»: quedan ${product.stock} pieza${product.stock === 1 ? "" : "s"} y la cotización pide ${item.quantity}`
          );
        }
        await db
          .update(schema.catalogProduct)
          .set({
            stock: sql`CASE WHEN ${schema.catalogProduct.stock} IS NULL THEN NULL ELSE GREATEST(${schema.catalogProduct.stock} - ${item.quantity}, 0) END`,
            updatedAt: new Date(),
          })
          .where(
            scoped(schema.catalogProduct.organizationId, organizationId, eq(schema.catalogProduct.id, item.productId))
          );
      }
    }

    await db.insert(schema.quoteEvent).values({
      id: newId("quoteEvent"),
      organizationId,
      quoteId,
      eventType: newStatus,
    });

    // Cotización aceptada → proyecto + orden de servicio, en la MISMA
    // transacción: si la conversión falla, nada queda a medias (la cotización
    // no se marca aceptada con relaciones incompletas). Idempotente por el
    // índice único (org, quoteId) de `project_quote` / `service_order`.
    let conversion: Awaited<ReturnType<typeof acceptQuoteIntoProjectTx>> | null = null;
    if (newStatus === "accepted") {
      conversion = await acceptQuoteIntoProjectTx(db, {
        organizationId,
        quote: { id: quoteId, quoteNumber: quote.quoteNumber, contactId: quote.contactId },
        actorUserId: opts?.actorUserId ?? null,
      });
    }

    return { quoteNumber: quote.quoteNumber, conversion };
  });

  publishWebhook(
    organizationId,
    newStatus === "accepted" ? "quote.accepted" : "quote.rejected",
    {
      quoteId,
      quoteNumber: done.quoteNumber,
      status: newStatus,
    }
  );

  // Efectos posteriores al commit (fuera de la transacción): webhooks de las
  // entidades creadas y sincronización de las tareas iniciales con Calendar.
  if (done.conversion) {
    const { projectId, projectCode, serviceOrderId, serviceOrderCode, projectCreated, serviceOrderCreated, taskIds } =
      done.conversion;
    if (projectCreated) {
      publishWebhook(organizationId, "project.created", {
        projectId,
        code: projectCode,
        quoteId,
        serviceOrderId,
      });
    }
    if (serviceOrderCreated) {
      publishWebhook(organizationId, "service_order.created", {
        serviceOrderId,
        code: serviceOrderCode,
        projectId,
        quoteId,
      });
    }
    for (const taskId of taskIds) {
      try {
        await syncTaskById(organizationId, taskId);
      } catch {
        // La agenda/Calendar es best-effort: no rompe la aceptación.
      }
    }
  }
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

/**
 * Cotizaciones aptas para vincular a un proyecto desde el desplegable de
 * "Nuevo proyecto": no archivadas y SIN proyecto vinculado (el índice único
 * project_quote_org_quote_uq no permite dos proyectos por cotización).
 * Une el nombre del contacto para armar "COT-0042 — María López", el
 * identificador que se usa como nombre del proyecto.
 */
export async function listQuotesForProjectLink(organizationId: string, limit = 100) {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.quote.id,
      quoteNumber: schema.quote.quoteNumber,
      status: schema.quote.status,
      total: schema.quote.total,
      currency: schema.quote.currency,
      contactId: schema.quote.contactId,
      contactName: schema.contact.name,
    })
    .from(schema.quote)
    .leftJoin(
      schema.contact,
      and(
        eq(schema.contact.id, schema.quote.contactId),
        eq(schema.contact.organizationId, organizationId)
      )
    )
    .where(
      and(
        scoped(schema.quote.organizationId, organizationId),
        sql`${schema.quote.archivedAt} IS NULL`,
        sql`NOT EXISTS (SELECT 1 FROM project_quote pq WHERE pq.organization_id = ${organizationId} AND pq.quote_id = ${schema.quote.id})`
      )
    )
    .orderBy(desc(schema.quote.createdAt))
    .limit(limit);

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
