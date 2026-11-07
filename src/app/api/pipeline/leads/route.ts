import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getContactById } from "@/server/contacts";
import { createLeadForContact } from "@/server/inbox/lead-activity";
import { updateLead } from "@/server/leads/service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  contactId: z.string().min(1),
  stageId: z.string().min(1).optional(),
  amountCents: z.number().int().min(0).max(1_000_000_000_00).nullable().optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const contact = await getContactById(session.organizationId, body.data.contactId);
  if (!contact) {
    return apiError(422, "invalid_contact", "El contacto no existe en esta organización.");
  }

  if (body.data.stageId) {
    const db = getDb();
    const [stage] = await db
      .select({ id: schema.pipelineStage.id, kind: schema.pipelineStage.kind })
      .from(schema.pipelineStage)
      .where(
        scoped(
          schema.pipelineStage.organizationId,
          session.organizationId,
          eq(schema.pipelineStage.id, body.data.stageId)
        )
      )
      .limit(1);
    if (!stage || (stage.kind !== "open" && stage.kind !== "qualified")) {
      return apiError(422, "invalid_stage", "La etapa no existe o no admite prospectos nuevos.");
    }
  }

  const created = await createLeadForContact({
    organizationId: session.organizationId,
    contactId: body.data.contactId,
    stageId: body.data.stageId,
    source: "dueno",
    actorUserId: session.userId,
  });
  if (!created) {
    return apiError(422, "no_open_stages", "No hay etapas abiertas para crear el prospecto.");
  }

  if (body.data.amountCents != null) {
    const updated = await updateLead({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      leadId: created.id,
      amountCents: body.data.amountCents,
    });
    if (!updated.ok) {
      return apiError(500, "amount_update_failed", updated.message);
    }
    return Response.json({ lead: updated.lead }, { status: 201 });
  }

  return Response.json({ lead: { id: created.id, stageId: created.stageId } }, { status: 201 });
});
