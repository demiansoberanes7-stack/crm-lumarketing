import { z } from "zod";
import { updateLead } from "@/server/leads/service";
import { defineAction } from "@/server/mcp/registry";

const lossReasonEnum = z.enum([
  "precio",
  "no_es_perfil",
  "sin_presupuesto",
  "eligio_otro",
  "nunca_contesto",
  "otro",
]);

/** Forma cruda reutilizable por herramientas nativas. */
export const pipelineUpdateLeadShape = {
  leadId: z.string().min(1).max(255),
  stageId: z.string().min(1).max(255).optional(),
  position: z.number().int().min(0).optional(),
  lossReason: lossReasonEnum.optional(),
  lossNote: z.string().trim().max(500).optional(),
  amountCents: z.number().int().min(0).max(1_000_000_000_00).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  priority: z.enum(["alta", "media", "baja"]).nullable().optional(),
};

const pipelineUpdateLead = z
  .object(pipelineUpdateLeadShape)
  .refine(
    (value) =>
      value.stageId !== undefined ||
      value.amountCents !== undefined ||
      value.priority !== undefined,
    { message: "Indica etapa, monto o prioridad" }
  );

export const pipelineActions = [
  defineAction({
    name: "pipeline.update_lead",
    domain: "pipeline",
    kind: "write",
    scope: "crm.pipeline.write",
    title: "Actualizar lead del pipeline",
    description:
      "Mueve un lead a otra etapa (con motivo de pérdida si es etapa perdida) y/o actualiza su monto, moneda o prioridad. Sin etapa no se mueve nada.",
    input: pipelineUpdateLead,
    handler: async (principal, input) => {
      const result = await updateLead({
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        ...input,
      });
      if (!result.ok) throw new Error(result.message);
      return {
        text: result.changed
          ? `Lead ${input.leadId} movido a ${result.lead.stageId}.`
          : `Lead ${input.leadId} actualizado.`,
        structuredContent: {
          leadId: result.lead.id,
          stageId: result.lead.stageId,
          changed: result.changed,
        },
      };
    },
  }),
];
