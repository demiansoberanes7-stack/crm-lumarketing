import { and, asc, eq, isNull, lte, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getIntegration } from "@/server/integrations";
import {
  listAutomationRules,
  resolveAutomationTriggers,
  type AutomationRuleConfig,
  type AutomationTrigger,
} from "@/server/automation-rules";
import { enqueueFollowUp } from "@/server/automation-queue";

/**
 * Los triggers automáticos de las reglas de automatización.
 *
 * La cola (`automation-queue.ts`) solo sabe despachar lo que ya está encolado
 * y el programador solo sabe mirar fechas: aquí es donde un EVENTO del negocio
 * (nació un lead, cambió de etapa, dejaron de escribir, un seguimiento salió)
 * se traduce en una fila de `automation_execution`.
 *
 * Todo lo de este módulo es best-effort: quien lo invoca está en medio de una
 * operación que al dueño le importa más que el seguimiento (mover una tarjeta,
 * recibir un mensaje). Un fallo aquí se loguea y jamás se propaga.
 */

type ArmedRule = AutomationRuleConfig & { triggers: AutomationTrigger[] };

const triggerWanted = (rule: ArmedRule, trigger: AutomationTrigger) =>
  rule.triggers.includes(trigger);

/** Reglas guardadas, activas y con un trigger reconocible. */
async function loadArmedRules(organizationId: string): Promise<ArmedRule[]> {
  const integration = await getIntegration(organizationId, "automation_rules");
  return listAutomationRules(integration?.credentials?.rules)
    .filter((rule) => rule.enabled === true)
    .map((rule) => ({ ...rule, triggers: resolveAutomationTriggers(rule) }))
    .filter((rule) => rule.triggers.length > 0);
}

/** La conversación real (no de prueba) del contacto; sin ella no hay envío. */
async function realConversationOf(
  organizationId: string,
  contactId: string
): Promise<{ id: string; channel: string; lastInboundAt: Date | null } | null> {
  const [conversation] = await getDb()
    .select({
      id: schema.conversation.id,
      channel: schema.conversation.channel,
      lastInboundAt: schema.conversation.lastInboundAt,
    })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.contactId, contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  return conversation ?? null;
}

async function leadOf(
  organizationId: string,
  contactId: string
): Promise<{
  createdAt: Date;
  lastActivityAt: Date | null;
  stageKind: string;
} | null> {
  const [row] = await getDb()
    .select({
      createdAt: schema.lead.createdAt,
      lastActivityAt: schema.lead.lastActivityAt,
      stageKind: schema.pipelineStage.kind,
    })
    .from(schema.lead)
    .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  return row ?? null;
}

/**
 * Cuándo empezó el silencio actual: la última vez que pasó algo (escrito el
 * contacto, actividad del lead o nacimiento). Es la referencia con la que el
 * dedup decide "ya lo perseguimos en esta racha" — en cuanto el contacto
 * vuelva a escribir, la fecha avanza y la regla se rearma sola.
 */
function silenceSince(
  lead: { createdAt: Date; lastActivityAt: Date | null },
  conversation: { lastInboundAt: Date | null }
): Date | null {
  const stamps = [lead.createdAt, lead.lastActivityAt, conversation.lastInboundAt]
    .map((value) => value?.getTime())
    .filter((value): value is number => typeof value === "number");
  if (!stamps.length) return null;
  return new Date(Math.max(...stamps));
}

/** El correo va al correo; el resto solo si la conversación está en ese canal. */
function channelMatches(rule: AutomationRuleConfig, channel: string): boolean {
  const ruleChannel = rule.channel ?? "whatsapp";
  return ruleChannel === "email" || ruleChannel === channel;
}

async function enqueueFor(
  rule: ArmedRule,
  trigger: AutomationTrigger,
  input: {
    organizationId: string;
    conversationId: string;
    channel: string;
    dedupSince: Date | null;
  }
): Promise<void> {
  if (!channelMatches(rule, input.channel)) return;
  await enqueueFollowUp({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    delayHours: rule.delayHours ?? 0,
    triggeredBy: trigger,
    ruleId: rule.id,
    dedupSince: input.dedupSince,
  });
}

/** Un lead entró al pipeline → `new_lead` (la "Bienvenida automática"). */
export async function onLeadCreated(input: {
  organizationId: string;
  contactId: string;
}): Promise<void> {
  try {
    const rules = (await loadArmedRules(input.organizationId)).filter((rule) =>
      triggerWanted(rule, "new_lead")
    );
    if (!rules.length) return;

    const conversation = await realConversationOf(input.organizationId, input.contactId);
    if (!conversation) return;
    const lead = await leadOf(input.organizationId, input.contactId);
    // Se encola una sola vez por lead: cualquier ejecución posterior al
    // nacimiento cuenta como "ya lo saludamos".
    const dedupSince = lead?.createdAt ?? null;
    for (const rule of rules) {
      await enqueueFor(rule, "new_lead", {
        organizationId: input.organizationId,
        conversationId: conversation.id,
        channel: conversation.channel,
        dedupSince,
      });
    }
  } catch (err) {
    console.error("[automations] No se pudo evaluar el alta del lead:", err);
  }
}

/** El lead cambió de etapa → `stage_change`. */
export async function onStageChanged(input: {
  organizationId: string;
  contactId: string;
  toStageId: string;
  toStageKind: string;
}): Promise<void> {
  try {
    const rules = (await loadArmedRules(input.organizationId)).filter((rule) =>
      triggerWanted(rule, "stage_change")
    );
    if (!rules.length) return;

    const conversation = await realConversationOf(input.organizationId, input.contactId);
    if (!conversation) return;
    const lead = await leadOf(input.organizationId, input.contactId);
    if (!lead) return;
    const dedupSince = silenceSince(lead, conversation);

    for (const rule of rules) {
      if (rule.stageId) {
        // Etapa elegida por el dueño: solo esa, aunque sea una perdida.
        if (rule.stageId !== input.toStageId) continue;
      } else if (input.toStageKind === "lost") {
        // Sin etapa objetivo no se persigue a un lead que acabó de perderse.
        continue;
      }
      await enqueueFor(rule, "stage_change", {
        organizationId: input.organizationId,
        conversationId: conversation.id,
        channel: conversation.channel,
        dedupSince,
      });
    }
  } catch (err) {
    console.error("[automations] No se pudo evaluar el cambio de etapa:", err);
  }
}

/**
 * `inactivity`: "sin actividad durante la espera". No tiene evento que lo
 * llame — es la ausencia de uno — así que lo barre el programador cada
 * minuto (`runAutomationWorkerOnce`).
 *
 * Una sola persecución por racha de silencio: `dedupSince` es el inicio de la
 * racha, así que una vez encolado o enviado no vuelve a tocarlo hasta que el
 * contacto escriba (que es lo que rearma la regla).
 */
export async function scanInactivity(): Promise<void> {
  try {
    const db = getDb();
    const integrations = await db
      .select({
        organizationId: schema.integration.organizationId,
        credentials: schema.integration.credentials,
      })
      .from(schema.integration)
      .where(eq(schema.integration.provider, "automation_rules"));

    for (const integration of integrations) {
      const credentials = integration.credentials as { rules?: unknown } | null;
      const rules = listAutomationRules(credentials?.rules)
        .filter((rule) => rule.enabled === true)
        .map((rule) => ({ ...rule, triggers: resolveAutomationTriggers(rule) }))
        .filter((rule) => triggerWanted(rule, "inactivity"));
      if (!rules.length) continue;

      const now = Date.now();
      const maxDelay = Math.max(...rules.map((rule) => rule.delayHours ?? 0));
      // Silencio en ÉPOCA (segundos): es un número y por eso se puede comparar
      // con el corte. Compararlo con un timestamp hacía fallar la query entera
      // (`operator does not exist: numeric <= timestamp with time zone`).
      const silence = sql<number>`extract(epoch from coalesce(${schema.conversation.lastInboundAt}, ${schema.lead.lastActivityAt}, ${schema.lead.createdAt}))`;
      // Solo se miran candidatos que ya cruzaron la espera más larga; después
      // cada regla vuelve a comparar con la suya.
      const corte = (now - maxDelay * 3_600_000) / 1000;
      const candidates = await db
        .select({
          conversationId: schema.conversation.id,
          channel: schema.conversation.channel,
          lastInboundAt: schema.conversation.lastInboundAt,
          lastActivityAt: schema.lead.lastActivityAt,
          leadCreatedAt: schema.lead.createdAt,
          silenceMs: silence,
        })
        .from(schema.lead)
        .innerJoin(schema.contact, eq(schema.contact.id, schema.lead.contactId))
        .innerJoin(schema.conversation, eq(schema.conversation.contactId, schema.contact.id))
        .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
        .where(
          and(
            scoped(schema.lead.organizationId, integration.organizationId),
            eq(schema.conversation.isTest, false),
            isNull(schema.contact.archivedAt),
            // Un lead perdido no se persigue; ganado y abiertos sí.
            ne(schema.pipelineStage.kind, "lost"),
            lte(silence, corte)
          )
        )
        .orderBy(asc(silence))
        .limit(50);

      for (const candidate of candidates) {
        const lead = {
          createdAt: candidate.leadCreatedAt,
          lastActivityAt: candidate.lastActivityAt,
        };
        const conversation = {
          id: candidate.conversationId,
          channel: candidate.channel,
          lastInboundAt: candidate.lastInboundAt,
        };
        const startedAt = silenceSince(lead, conversation);
        if (!startedAt || startedAt.getTime() > now) continue;

        for (const rule of rules) {
          const delayMs = (rule.delayHours ?? 0) * 3_600_000;
          if (startedAt.getTime() > now - delayMs) continue; // aún no pasó la espera
          await enqueueFor(rule, "inactivity", {
            organizationId: integration.organizationId,
            conversationId: conversation.id,
            channel: conversation.channel,
            dedupSince: startedAt,
          });
        }
      }
    }
  } catch (err) {
    console.error("[automations] Falló el barrido de inactividad:", err);
  }
}

/**
 * `no_reply`: "sin respuesta tras el primer seguimiento". La cadena se lanza
 * cuando un seguimiento SALE y solo desde reglas que no son de esta familia
 * — si no, cada envío desencadenaría el siguiente para siempre.
 */
export async function onFollowUpSent(input: {
  organizationId: string;
  conversationId: string;
  sourceRuleId: string;
}): Promise<void> {
  try {
    const rules = await loadArmedRules(input.organizationId);
    const source = rules.find((rule) => rule.id === input.sourceRuleId);
    if (source && triggerWanted(source, "no_reply")) return;

    const targets = rules.filter(
      (rule) => triggerWanted(rule, "no_reply") && rule.id !== input.sourceRuleId
    );
    if (!targets.length) return;

    const [conversation] = await getDb()
      .select({ channel: schema.conversation.channel })
      .from(schema.conversation)
      .where(
        scoped(
          schema.conversation.organizationId,
          input.organizationId,
          eq(schema.conversation.id, input.conversationId)
        )
      )
      .limit(1);
    if (!conversation) return;

    for (const rule of targets) {
      await enqueueFor(rule, "no_reply", {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        channel: conversation.channel,
        // Se rearma con cada envío, así que el dedup solo mira la cola.
        dedupSince: null,
      });
    }
  } catch (err) {
    console.error("[automations] No se pudo encadenar el segundo seguimiento:", err);
  }
}
