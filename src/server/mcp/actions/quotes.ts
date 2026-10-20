import { z } from "zod";
import {
  archiveQuote,
  changeQuoteStatus,
  createQuote,
  deleteQuote,
  getQuote,
  listQuotes,
  sendQuote,
  unarchiveQuote,
  updateQuote,
} from "@/server/quotes/service";
import { sendActionError } from "./send-errors";
import { defineAction } from "@/server/mcp/registry";

const itemSchema = z.object({
  productId: z.string().min(1).max(255).nullable().optional(),
  name: z.string().min(1),
  description: z.string().max(4000).nullable().optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().int().min(0),
});

/** Forma cruda reutilizable por la herramienta nativa `create_quote`. */
export const quotesCreateShape = {
  contactId: z.string().min(1).max(255).nullable().optional(),
  items: z.array(itemSchema).min(1),
  discountType: z.enum(["fixed", "percentage"]).nullable().optional(),
  discountValue: z.number().int().min(0).nullable().optional(),
  taxRate: z.number().int().min(0).max(100).optional(),
  validDays: z.number().int().min(1).max(365).optional(),
  notes: z.string().max(10000).optional(),
  paymentConditions: z.string().max(2000).optional(),
  paymentMethod: z.record(z.unknown()).nullable().optional(),
};

const quotesCreate = z.object(quotesCreateShape);

const quotesUpdate = z
  .object({
    quoteId: z.string().min(1).max(255),
    contactId: z.string().min(1).max(255).nullable().optional(),
    items: z.array(itemSchema).min(1).optional(),
    discountType: z.enum(["fixed", "percentage"]).nullable().optional(),
    discountValue: z.number().int().min(0).nullable().optional(),
    taxRate: z.number().int().min(0).max(100).optional(),
    validDays: z.number().int().min(1).max(365).optional(),
    notes: z.string().max(10000).optional(),
    paymentConditions: z.string().max(2000).optional(),
    paymentMethod: z.record(z.unknown()).nullable().optional(),
  })
  .refine(
    (value) =>
      value.contactId !== undefined ||
      value.items !== undefined ||
      value.discountType !== undefined ||
      value.discountValue !== undefined ||
      value.taxRate !== undefined ||
      value.validDays !== undefined ||
      value.notes !== undefined ||
      value.paymentConditions !== undefined ||
      value.paymentMethod !== undefined,
    { message: "Al menos un campo es obligatorio" }
  );

const quoteIdInput = z.object({ quoteId: z.string().min(1).max(255) });

const quotesSetStatus = z.object({
  quoteId: z.string().min(1).max(255),
  status: z.enum(["accepted", "rejected"]),
});

const quotesList = z.object({
  status: z.string().trim().max(20).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
  archived: z.boolean().optional(),
});

/** Forma cruda reutilizable por la herramienta nativa `send_quote`. */
export const quotesSendShape = {
  quoteId: z.string().min(1).max(255),
  channel: z.enum(["whatsapp", "instagram", "messenger"]),
  conversationId: z.string().min(1).max(64).optional(),
};

const quotesSend = z.object(quotesSendShape);

export const quotesActions = [
  defineAction({
    name: "quotes.create",
    domain: "quotes",
    kind: "write",
    scope: "crm.quotes.write",
    title: "Crear cotización",
    description:
      "Crea una cotización con sus partidas (nombre, cantidad y precio en centavos); valida stock y contacto de la organización.",
    input: quotesCreate,
    handler: async (principal, input) => {
      const quoteId = await createQuote(
        principal.organizationId,
        {
          contactId: input.contactId ?? undefined,
          items: input.items.map((item) => ({
            productId: item.productId ?? undefined,
            name: item.name,
            description: item.description ?? undefined,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
          discountType: input.discountType,
          discountValue: input.discountValue,
          taxRate: input.taxRate,
          validDays: input.validDays,
          notes: input.notes,
          paymentConditions: input.paymentConditions,
          paymentMethod: input.paymentMethod ?? undefined,
        },
        principal.userId
      );
      const quote = await getQuote(principal.organizationId, quoteId);
      return {
        text: `Cotización ${quote?.quoteNumber ?? quoteId} creada.`,
        structuredContent: {
          quoteId,
          quoteNumber: quote?.quoteNumber ?? null,
          total: quote?.total ?? null,
        },
      };
    },
  }),

  defineAction({
    name: "quotes.update",
    domain: "quotes",
    kind: "write",
    scope: "crm.quotes.write",
    title: "Actualizar cotización",
    description: "Edita partidas, descuento, impuestos o condiciones de una cotización en borrador.",
    input: quotesUpdate,
    handler: async (principal, input) => {
      const { quoteId, ...patch } = input;
      await updateQuote(principal.organizationId, quoteId, {
        contactId: patch.contactId,
        items: patch.items?.map((item) => ({
          productId: item.productId ?? undefined,
          name: item.name,
          description: item.description ?? undefined,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
        discountType: patch.discountType,
        discountValue: patch.discountValue,
        taxRate: patch.taxRate,
        validDays: patch.validDays,
        notes: patch.notes,
        paymentConditions: patch.paymentConditions,
        paymentMethod: patch.paymentMethod ?? undefined,
      });
      return {
        text: `Cotización ${quoteId} actualizada.`,
        structuredContent: { quoteId },
      };
    },
  }),

  defineAction({
    name: "quotes.set_status",
    domain: "quotes",
    kind: "write",
    scope: "crm.quotes.write",
    title: "Aceptar o rechazar cotización",
    description:
      "Marca una cotización (borrador, enviada o vista) como aceptada o rechazada; una aceptada genera el proyecto del ciclo comercial.",
    input: quotesSetStatus,
    handler: async (principal, input) => {
      await changeQuoteStatus(principal.organizationId, input.quoteId, input.status, {
        actorUserId: principal.userId,
      });
      return {
        text: `Cotización marcada como ${input.status}.`,
        structuredContent: { quoteId: input.quoteId, status: input.status },
      };
    },
  }),

  defineAction({
    name: "quotes.archive",
    domain: "quotes",
    kind: "write",
    scope: "crm.quotes.write",
    title: "Archivar cotización",
    description: "Archiva una cotización para sacarla de la lista activa sin perderla.",
    input: quoteIdInput,
    handler: async (principal, input) => {
      await archiveQuote(principal.organizationId, input.quoteId);
      return {
        text: `Cotización ${input.quoteId} archivada.`,
        structuredContent: { quoteId: input.quoteId, archived: true },
      };
    },
  }),

  defineAction({
    name: "quotes.unarchive",
    domain: "quotes",
    kind: "write",
    scope: "crm.quotes.write",
    title: "Restaurar cotización archivada",
    description: "Devuelve una cotización archivada a la lista activa.",
    input: quoteIdInput,
    handler: async (principal, input) => {
      await unarchiveQuote(principal.organizationId, input.quoteId);
      return {
        text: `Cotización ${input.quoteId} restaurada.`,
        structuredContent: { quoteId: input.quoteId, archived: false },
      };
    },
  }),

  defineAction({
    name: "quotes.delete",
    domain: "quotes",
    kind: "delete",
    scope: "crm.quotes.delete",
    title: "Eliminar cotización",
    description:
      "Elimina permanentemente una cotización con sus partidas y eventos. Solo aplica a cotizaciones archivadas. No se puede deshacer.",
    destructive: true,
    input: quoteIdInput,
    handler: async (principal, input) => {
      await deleteQuote(principal.organizationId, input.quoteId);
      return {
        text: `Cotización ${input.quoteId} eliminada.`,
        structuredContent: { quoteId: input.quoteId, deleted: true },
      };
    },
  }),

  defineAction({
    name: "quotes.send",
    domain: "quotes",
    kind: "send",
    scope: "crm.quotes.send",
    title: "Enviar cotización al cliente",
    description:
      "Envía la cotización al chat del contacto por WhatsApp, Instagram o Messenger (usa conversations.list si necesitas elegir el chat). Solo borradores; respeta la ventana de respuesta y nunca toca conversaciones de prueba. Los hilos de correo se responden desde el cotizador, no por esta acción.",
    destructive: true,
    input: quotesSend,
    handler: async (principal, input) => {
      try {
        const result = await sendQuote(principal.organizationId, input.quoteId, {
          channel: input.channel,
          conversationId: input.conversationId,
        });
        return {
          text: `Cotización enviada por ${input.channel}.`,
          structuredContent: {
            quoteId: input.quoteId,
            channel: input.channel,
            total: result.total,
            waMessageId: result.waMessageId ?? null,
          },
        };
      } catch (err) {
        throw sendActionError(err);
      }
    },
  }),

  defineAction({
    name: "quotes.list",
    domain: "quotes",
    kind: "read",
    scope: "crm.quotes.read",
    title: "Listar cotizaciones",
    description: "Lista cotizaciones de la organización con filtro de estado, paginación y archivo.",
    input: quotesList,
    handler: async (principal, input) => {
      const rows = await listQuotes(principal.organizationId, {
        status: input.status,
        limit: input.limit,
        offset: input.offset,
        archived: input.archived,
      });
      return {
        text: `Se encontraron ${rows.length} cotizaciones.`,
        structuredContent: { count: rows.length, quotes: rows },
      };
    },
  }),

  defineAction({
    name: "quotes.get",
    domain: "quotes",
    kind: "read",
    scope: "crm.quotes.read",
    title: "Obtener cotización",
    description: "Devuelve una cotización por ID con sus partidas y datos del contacto.",
    input: quoteIdInput,
    handler: async (principal, input) => {
      const quote = await getQuote(principal.organizationId, input.quoteId);
      if (!quote) throw new Error("Cotización no encontrada");
      return {
        text: quote.quoteNumber,
        structuredContent: { quote },
      };
    },
  }),
];
