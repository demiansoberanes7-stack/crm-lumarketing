import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { recordLeadCreated } from "@/server/leads/stage-history";
import { recordLeadFirstTouch } from "@/server/attribution/touch";
import { publishWebhook } from "@/server/webhooks/dispatcher";
import type { StageChangeSource } from "@/lib/types";

/**
 * Lead con más derechos sobre el contacto: el principal y, de igual, el más
 * activo. Es función y no constante de módulo a propósito: los tests de unit
 * mockean `@/lib/db` con un `schema` parcial, y evaluar `schema.lead` al
 * importar revienta módulos que ni siquiera hablan de leads.
 */
function leadPreferenceOrder() {
  return [
    desc(schema.lead.isPrimary),
    desc(schema.lead.lastActivityAt),
    desc(schema.lead.createdAt),
  ];
}

/** Conexión o transacción. Mismo atajo que usa el resto del ciclo comercial. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any;

/**
 * Deja la última actividad en el máximo entre lo que traía el lead y la nueva
 * (dos webhooks simultáneos no pueden atrasarla).
 *
 * Nota para el guardarraíl de `stage-history`: es el único `.update(schema.lead)`
 * de este archivo y no toca `stageId` — solo refresca actividad. Se mantiene
 * en una función aparte al final para que el análisis de bloques de esa
 * prueba no alcance escrituras de etapa de otros flujos.
 */
async function refreshLeadActivity(db: DbOrTx, leadId: string, at: Date): Promise<void> {
  const activityAt = sql.param(at, schema.lead.lastActivityAt);
  await db
    .update(schema.lead)
    .set({
      lastActivityAt: sql`GREATEST(COALESCE(${schema.lead.lastActivityAt}, ${activityAt}), ${activityAt})`,
      updatedAt: new Date(),
    })
    .where(eq(schema.lead.id, leadId));
}

/**
 * Actividad de lead al recibir un mensaje (US2): si el contacto no tiene lead,
 * se crea en la primera etapa del pipeline; si lo tiene, se actualiza su
 * última actividad.
 */
export async function onLeadActivity(
  organizationId: string,
  contactId: string,
  at: Date
): Promise<void> {
  const db = getDb();

  const existing = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(eq(schema.lead.contactId, contactId))
    .orderBy(...leadPreferenceOrder())
    .limit(1);

  if (existing[0]) {
    await refreshLeadActivity(db, existing[0].id, at);
    return;
  }

  await createLeadForContact({ organizationId, contactId, at });
}

/**
 * Crea la oportunidad de un contacto. Lo comparten el webhook (sin `stageId`:
 * primera etapa abierta) y la captura manual (con la etapa que elija el dueño).
 * Vive en un solo sitio a propósito: el cálculo de la posición, la carrera
 * entre dos webhooks y el registro en la bitácora son lo bastante sutiles como
 * para que dos copias diverjan en el primer cambio.
 *
 * **Multi-oportunidad** (se levantó `lead_contact_uq`): un contacto puede tener
 * varias oportunidades. La que reutiliza el webhook es la que sigue ABIERTA;
 * si todas se cerraron, un mensaje nuevo abre otra. La captura manual nunca
 * reutiliza: el dueño pidió otra oportunidad a propósito. Quien nace primero
 * queda como `isPrimary` (las rutas 1:1 operan sobre él).
 *
 * Devuelve `null` si el pipeline no tiene etapas abiertas — quien llama decide
 * si eso es un error que mostrar (captura manual) o un silencio aceptable
 * (webhook: jamás debe tumbar la ingesta de un mensaje).
 */
export async function createLeadForContact(input: {
  organizationId: string;
  contactId: string;
  stageId?: string;
  at?: Date;
  /** Quién dio de alta: el webhook es `sistema`, la captura manual `dueno`. */
  source?: StageChangeSource;
  actorUserId?: string | null;
}): Promise<{ id: string; stageId: string; reused?: boolean } | null> {
  const db = getDb();

  // Toda la decisión (¿hay oportunidad abierta? ¿quién es la principal? ¿cuál
  // es la posición?) corre dentro de la transacción y tras el advisory lock:
  // el índice único que antes impedía duplicados ya no existe, y sin este
  // candado dos webhooks simultáneos abrirían la misma oportunidad.
  const creado = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.organizationId}:${input.contactId}`}))`
    );

    let stageId = input.stageId;
    if (!stageId) {
      const firstStage = await tx
        .select({ id: schema.pipelineStage.id })
        .from(schema.pipelineStage)
        .where(
          and(
            eq(schema.pipelineStage.organizationId, input.organizationId),
            eq(schema.pipelineStage.kind, "open")
          )
        )
        .orderBy(asc(schema.pipelineStage.position))
        .limit(1);
      if (!firstStage[0]) return null;
      stageId = firstStage[0].id;

      const [open] = await tx
        .select({ id: schema.lead.id, leadStageId: schema.lead.stageId })
        .from(schema.lead)
        .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
        .where(
          and(
            eq(schema.lead.contactId, input.contactId),
            eq(schema.pipelineStage.kind, "open")
          )
        )
        .orderBy(...leadPreferenceOrder())
        .limit(1);
      if (open) {
        const reuse = { id: open.id, stageId: open.leadStageId, reused: true };
        await refreshLeadActivity(tx, open.id, input.at ?? new Date());
        return reuse;
      }
    }

    const maxPos = await tx
      .select({ max: sql<number>`coalesce(max(${schema.lead.position}), -1)` })
      .from(schema.lead)
      .where(
        and(
          eq(schema.lead.organizationId, input.organizationId),
          eq(schema.lead.stageId, stageId)
        )
      );

    const [previo] = await tx
      .select({ id: schema.lead.id })
      .from(schema.lead)
      .where(eq(schema.lead.contactId, input.contactId))
      .limit(1);

    const inserted = await tx
      .insert(schema.lead)
      .values({
        id: newId("lead"),
        organizationId: input.organizationId,
        contactId: input.contactId,
        stageId,
        position: (maxPos[0]?.max ?? -1) + 1,
        lastActivityAt: input.at ?? null,
        isPrimary: !previo,
      })
      .returning({ id: schema.lead.id, stageId: schema.lead.stageId });

    const fila = inserted[0];
    return fila ? { id: fila.id, stageId: fila.stageId, reused: false } : null;
  });

  if (!creado) return null;
  // Ya existía una oportunidad abierta: no nació nada, así que no hay
  // bitácora, ni webhook, ni automatización que disparar.
  if (creado.reused) return creado;

  // El nacimiento de la oportunidad es el primer evento del embudo: sin él,
  // "prospectos que entraron en el periodo" no se podría contar desde la
  // bitácora. Va aquí DENTRO y no en quien llama, porque los caminos que crean
  // leads son varios y el segundo que alguien agregue lo olvidaría.
  await recordLeadCreated({
    organizationId: input.organizationId,
    leadId: creado.id,
    contactId: input.contactId,
    stageId: creado.stageId,
    occurredAt: input.at,
    actorUserId: input.actorUserId ?? null,
    source: input.source ?? "sistema",
  });

  publishWebhook(input.organizationId, "lead.created", {
    lead: { id: creado.id, stageId: creado.stageId },
    contactId: input.contactId,
  });

  // Primer toque de atribución del contacto (first touch). Best-effort: la
  // atribución nunca puede tumbar el alta de la oportunidad.
  await recordLeadFirstTouch({
    organizationId: input.organizationId,
    contactId: input.contactId,
    occurredAt: input.at ?? undefined,
  });

  // Reglas de automatización con trigger "entró al pipeline" (la bienvenida).
  // Best-effort y con import dinámico por el mismo motivo que los webhooks:
  // jamás puede tumbar el alta del lead ni enredar el grafo de imports.
  try {
    const { onLeadCreated } = await import("@/server/automation-events");
    await onLeadCreated({ organizationId: input.organizationId, contactId: input.contactId });
  } catch (err) {
    console.error("[automations] No se pudo evaluar el alta del lead:", err);
  }

  return creado;
}
