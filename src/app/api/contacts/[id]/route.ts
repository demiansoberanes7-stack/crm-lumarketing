import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  deleteContact,
  getContactById,
  getContactStage,
  serializeContact,
  updateContact,
} from "@/server/contacts";

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

  // Misma fuente que el MCP: identidad, ficha, compra y la nota derivada de
  // cambios en notas viven en un solo lugar (server/contacts.ts).
  const result = await updateContact({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    contactId: id,
    ...body.data,
  });
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 422;
    return apiError(status, result.code, result.message);
  }
  return Response.json({ contact: result.contact });
});

/** DELETE — eliminar contacto permanentemente */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const result = await deleteContact(session.organizationId, id);
  if (!result.ok) return apiError(404, result.code, result.message);
  return Response.json({ deleted: true });
});
