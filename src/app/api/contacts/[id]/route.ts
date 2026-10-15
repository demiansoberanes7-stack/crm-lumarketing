import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  getContactById,
  getContactStage,
  serializeContact,
} from "@/server/contacts";
import { normalizeMedium } from "@/lib/contact-medium";
import { normalizeMx } from "@/lib/meta/client";
import { upsertFicha } from "@/server/bot/ficha";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const contact = await getContactById(session.organizationId, id);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado");
  const stageRow = await getContactStage(session.organizationId, id);
  return Response.json({
    contact: serializeContact(
      contact,
      stageRow?.stage.name ?? null,
      null,
      stageRow?.lead.amountCents ?? null
    ),
    stage: stageRow
      ? {
          id: stageRow.stage.id,
          name: stageRow.stage.name,
          position: stageRow.stage.position,
          kind: stageRow.stage.kind,
        }
      : null,
    lead: stageRow ? { id: stageRow.lead.id } : null,
  });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().max(20).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  archived: z.boolean().optional(),
  ficha: z.record(z.unknown()).optional(),
  medium: z.unknown().optional(),
  mediumDetail: z.unknown().optional(),
  source: z
    .enum(["anuncio", "organico", "referido", "conocido", "compra", "otro"])
    .nullable()
    .optional(),
  /** Detalle de la compra: solo tiene sentido con `source = "compra"`. */
  purchaseProduct: z.string().trim().max(255).nullable().optional(),
  purchaseDate: z
    .string()
    .max(30)
    .nullable()
    .optional()
    .refine((v) => v == null || v === "" || !Number.isNaN(Date.parse(v)), {
      message: "Fecha de compra inválida",
    }),
  purchaseAmountCents: z.number().int().nullable().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const current = await getContactById(session.organizationId, id);
  if (!current) return apiError(404, "not_found", "Contacto no encontrado");

  if (body.data.ficha !== undefined) {
    const res = await upsertFicha({
      organizationId: session.organizationId,
      contactId: id,
      ficha: body.data.ficha,
    });
    if (!res) return apiError(404, "not_found", "Contacto no encontrado");
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };

  const mediumTocado =
    body.data.medium !== undefined || body.data.mediumDetail !== undefined;
  if (mediumTocado) {
    const medium = normalizeMedium({
      medium: body.data.medium ?? null,
      mediumDetail: body.data.mediumDetail ?? null,
    });
    if (!medium.ok) return apiError(422, "medium", medium.error);
    set.medium = medium.medium;
    set.mediumDetail = medium.mediumDetail;
  }
  if (body.data.name !== undefined) {
    set.name = body.data.name;
    set.nameSource = "manual";
  }
  if (body.data.phone !== undefined) {
    // Normaliza al formato canónico (solo dígitos + 521→52): es el mismo
    // formato con el que la ingesta guarda `phone`/`wa_identity`, así el
    // matcher por teléfono sigue funcionando.
    const phone = body.data.phone ? normalizeMx(body.data.phone.replace(/\D/g, "")) : null;
    set.phone = phone;
    // La identidad de WhatsApp SIN prefijo ES el teléfono normalizado: si el
    // operador corrige el número, la identidad debe seguirlo — si no, el
    // próximo mensaje del cliente crea un contacto nuevo y el historial se
    // parte en dos. Identidades con prefijo (bsuid:, ig:, fb:, tt:) no se
    // tocan: son llaves de plataforma, no teléfono.
    if (phone && current.channel === "whatsapp" && !current.waIdentity.includes(":")) {
      set.waIdentity = phone;
    }
  }
  if (body.data.notes !== undefined) set.notes = body.data.notes;
  if (body.data.archived !== undefined) {
    set.archivedAt = body.data.archived ? new Date() : null;
  }
  if (body.data.source !== undefined) set.source = body.data.source;
  // El detalle de compra solo aplica a la fuente "Compra": cambiar la fuente a
  // otro valor borra el rastro para que la ficha no muestre una compra que ya
  // no es la fuente de este contacto.
  const fuenteEsCompra =
    body.data.source !== undefined ? body.data.source === "compra" : current.source === "compra";
  if (fuenteEsCompra) {
    if (body.data.purchaseProduct !== undefined) set.purchaseProduct = body.data.purchaseProduct;
    if (body.data.purchaseDate !== undefined) {
      set.purchaseDate = body.data.purchaseDate ? new Date(body.data.purchaseDate) : null;
    }
    if (body.data.purchaseAmountCents !== undefined) {
      set.purchaseAmountCents = body.data.purchaseAmountCents;
    }
  } else if (body.data.source !== undefined) {
    set.purchaseProduct = null;
    set.purchaseDate = null;
    set.purchaseAmountCents = null;
  }

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.contact)
      .set(set)
      .where(
        scoped(
          schema.contact.organizationId,
          session.organizationId,
          eq(schema.contact.id, id)
        )
      );
    if (body.data.notes !== undefined && body.data.notes !== current.notes) {
      await tx.insert(schema.contactNote).values({
        id: newId("contactNote"),
        organizationId: session.organizationId,
        contactId: id,
        body: body.data.notes ?? "",
        source: "manual",
        createdBy: session.userId,
      });
    }
  });
  const contact = await getContactById(session.organizationId, id);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado");
  return Response.json({ contact: serializeContact(contact) });
});

/** DELETE — eliminar contacto permanentemente */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();

  const contact = await getContactById(session.organizationId, id);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado");

  await db
    .delete(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        session.organizationId,
        eq(schema.contact.id, id)
      )
    );

  return Response.json({ deleted: true });
});
