/**
 * Ciclo comercial — convertir una cotización aceptada en proyecto + orden de
 * servicio, sin exigir que el usuario cree el proyecto a mano.
 *
 * Se ejecuta **dentro de la transacción** de `changeQuoteStatus` (misma tx que
 * valida la transición y descuenta inventario) para que un error no deje una
 * cotización aceptada con relaciones incompletas.
 *
 * Idempotencia:
 *  - `project_quote` tiene `unique(organizationId, quoteId)` → una cotización
 *    se vincula a un solo proyecto y reprocesar no duplica.
 *  - `service_order` tiene `unique(organizationId, quoteId)` → una sola orden
 *    por cotización.
 */
import { desc, eq, isNull } from "drizzle-orm";
import { schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { DEFAULT_PROJECT_STAGES } from "@/lib/project-contract";
import { frozenStepDefinition } from "@/lib/project-templates";
import { isProjectTypeKey } from "@/lib/project-types";
import { ensureServiceOrderTx } from "@/server/service-orders/service";
import { nextProjectCode } from "./service";
import { ensureProjectTemplates, templateStepDefs } from "./templates";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface QuoteForConversion {
  id: string;
  quoteNumber: string;
  contactId: string | null;
}

export interface ConversionResult {
  projectId: string;
  serviceOrderId: string;
  projectCreated: boolean;
  serviceOrderCreated: boolean;
  projectCode: string;
  serviceOrderCode: string;
  /** Tareas sembradas (solo al crear proyecto); se sincronizan a Calendar tras el commit. */
  taskIds: string[];
}

/** Estados de proyecto que siguen vivos (se puede vincular trabajo nuevo). */
const OPEN_PROJECT_STATUSES = ["borrador", "planeacion", "en_proceso", "en_revision"];

export interface InferenceTemplate {
  key: string;
  label: string;
  description: string | null;
  isDefault: boolean;
}

/** Heurística histórica por palabras del nombre de las partidas. */
function detectKnownWorkType(
  items: { name: string }[]
): "maintenance" | "web_service" | "marketing" | null {
  const text = items.map((i) => i.name.toLowerCase()).join(" ");
  if (/\b(pc|laptop|computadora|equipo|mantenimiento|reparaci|formateo|hardware|software)\b/.test(text)) {
    return "maintenance";
  }
  if (/\b(web|sitio|p[aá]gina|landing|e-?commerce|dominio|hosting|app|portal)\b/.test(text)) {
    return "web_service";
  }
  if (/\b(marketing|campa|publicidad|redes|instagram|facebook|contenido|anuncio|seo|ads)\b/.test(text)) {
    return "marketing";
  }
  return null;
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Infiere el proceso de proyecto a partir de las partidas cotizadas. Sin
 * `templates` conserva la heurística histórica (marketing por defecto). Con
 * `templates`, solo devuelve claves activas: primero la heurística conocida,
 * luego el nombre/descripción de los procesos personalizados y, ante la duda,
 * el proceso predeterminado.
 */
export function inferProjectTypeFromQuoteItems(
  items: { name: string; description?: string | null }[],
  override?: string,
  templates?: InferenceTemplate[]
): string {
  if (!templates?.length) {
    if (override && isProjectTypeKey(override)) return override;
    return detectKnownWorkType(items) ?? "marketing";
  }
  const byKey = new Map(templates.map((template) => [template.key, template]));
  if (override && byKey.has(override)) return override;

  const known = detectKnownWorkType(items);
  if (known && byKey.has(known)) return known;

  const text = normalizeForMatch(
    items.map((item) => `${item.name} ${item.description ?? ""}`).join(" ")
  );
  for (const template of templates) {
    const tokens = normalizeForMatch(`${template.label} ${template.description ?? ""}`)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4);
    if (tokens.some((token) => text.includes(token))) return template.key;
  }
  const fallback = templates.find((template) => template.isDefault) ?? templates[0]!;
  return fallback.key;
}

export interface ProjectCandidate {
  id: string;
  contactId: string | null;
  projectType: string;
  status: string;
  archivedAt: Date | null;
}

/**
 * Elige el proyecto existente al que pertenece una cotización aceptada, o null
 * si hay que crear uno. Regla determinista y conservadora: mismo cliente,
 * mismo tipo de trabajo, vivo. Evita mezclar trabajos no relacionados.
 */
export function pickProjectForQuote(
  candidates: ProjectCandidate[],
  quoteContactId: string | null,
  projectType: string
): string | null {
  if (!quoteContactId) return null;
  const match = candidates.find(
    (p) =>
      p.contactId === quoteContactId &&
      p.projectType === projectType &&
      !p.archivedAt &&
      OPEN_PROJECT_STATUSES.includes(p.status)
  );
  return match?.id ?? null;
}

/** Etapas de proyecto por defecto; siembra si la org aún no tiene ninguna. */
async function ensureStagesTx(db: Db, organizationId: string): Promise<string | undefined> {
  const read = () =>
    db
      .select({ id: schema.projectStage.id })
      .from(schema.projectStage)
      .where(scoped(schema.projectStage.organizationId, organizationId))
      .orderBy(schema.projectStage.position);
  let stages = await read();
  if (stages.length !== DEFAULT_PROJECT_STAGES.length) {
    // Mismo esquema determinista de IDs que `getProjectStages` del módulo de
    // proyectos, para no duplicar etapas si ambos corren.
    await db
      .insert(schema.projectStage)
      .values(
        DEFAULT_PROJECT_STAGES.map((name, position) => ({
          id: `pst_${organizationId}_${position}`,
          organizationId,
          name,
          position,
        }))
      )
      .onConflictDoNothing();
    stages = await read();
  }
  return stages[0]?.id;
}

/**
 * Núcleo transaccional: vincula (o crea) el proyecto y la orden de servicio de
 * una cotización aceptada. NO publica webhooks ni sincroniza Calendar — eso se
 * hace después del commit.
 */
export async function acceptQuoteIntoProjectTx(
  db: Db,
  params: {
    organizationId: string;
    quote: QuoteForConversion;
    actorUserId?: string | null;
    projectTypeOverride?: string;
  }
): Promise<ConversionResult> {
  const { organizationId, quote } = params;

  // 1) Idempotencia: ¿la cotización ya está vinculada a un proyecto?
  const [existingLink] = await db
    .select({ projectId: schema.projectQuote.projectId })
    .from(schema.projectQuote)
    .where(
      scoped(
        schema.projectQuote.organizationId,
        organizationId,
        eq(schema.projectQuote.quoteId, quote.id)
      )
    )
    .limit(1);
  if (existingLink) {
    const order = await ensureServiceOrderTx(db, {
      organizationId,
      projectId: existingLink.projectId,
      quoteId: quote.id,
      contactId: quote.contactId,
      title: `Orden de ${quote.quoteNumber}`,
      createdBy: params.actorUserId ?? null,
    });
    return {
      projectId: existingLink.projectId,
      serviceOrderId: order.id,
      projectCreated: false,
      serviceOrderCreated: order.created,
      projectCode: "",
      serviceOrderCode: "",
      taskIds: [],
    };
  }

  // 2) Partidas de la cotización y tipo de proyecto.
  const items = await db
    .select({
      name: schema.quoteItem.name,
      description: schema.quoteItem.description,
      quantity: schema.quoteItem.quantity,
      unitPrice: schema.quoteItem.unitPrice,
      productId: schema.quoteItem.productId,
    })
    .from(schema.quoteItem)
    .where(
      scoped(
        schema.quoteItem.organizationId,
        organizationId,
        eq(schema.quoteItem.quoteId, quote.id)
      )
    )
    .orderBy(schema.quoteItem.position);

  // Procesos activos del negocio: la inferencia solo puede devolver claves
  // que existan (los tres base se siembran si es la primera vez).
  const templateRows = await ensureProjectTemplates(organizationId, db);

  const projectType = inferProjectTypeFromQuoteItems(
    items,
    params.projectTypeOverride,
    templateRows.map((row: {
      key: string;
      label: string;
      description: string | null;
      isDefault: boolean;
    }) => ({
      key: row.key,
      label: row.label,
      description: row.description,
      isDefault: row.isDefault,
    }))
  );
  const template = templateRows.find((row: { key: string }) => row.key === projectType) ?? templateRows[0];
  if (!template) throw new Error("No hay procesos de proyecto configurados");

  // 3) ¿Existe un proyecto compatible al que pertenece esta cotización?
  const candidates: ProjectCandidate[] = quote.contactId
    ? await db
        .select({
          id: schema.project.id,
          contactId: schema.project.contactId,
          projectType: schema.project.projectType,
          status: schema.project.status,
          archivedAt: schema.project.archivedAt,
        })
        .from(schema.project)
        .where(
          scoped(
            schema.project.organizationId,
            organizationId,
            eq(schema.project.contactId, quote.contactId),
            eq(schema.project.projectType, projectType),
            isNull(schema.project.archivedAt)
          )
        )
        .orderBy(desc(schema.project.createdAt))
    : [];

  const linkedProjectId = pickProjectForQuote(candidates, quote.contactId, projectType);

  let projectId: string;
  let projectCreated = false;
  let projectCode = "";
  const taskIds: string[] = [];

  if (linkedProjectId) {
    projectId = linkedProjectId;
  } else {
    projectCreated = true;
    projectId = newId("project");
    projectCode = await nextProjectCode(db, organizationId);

    const stageId = await ensureStagesTx(db, organizationId);
    await db.insert(schema.project).values({
      id: projectId,
      organizationId,
      code: projectCode,
      name: `Proyecto ${quote.quoteNumber}`,
      contactId: quote.contactId,
      projectType,
      projectTypeLabel: template.label,
      status: "borrador",
      estado: "activo",
      avance: 0,
      stageId,
    });

    // Sembrar el stepper del expediente (idempotente), congelando la
    // definición de cada paso tal como está hoy el proceso.
    const stepDefs = templateStepDefs(template);
    await db
      .insert(schema.projectStep)
      .values(
        stepDefs.map((def, position) => ({
          id: newId("projectStep"),
          organizationId,
          projectId,
          stepKey: def.key,
          position,
          status: "pendiente",
          data: {},
          definition: frozenStepDefinition(def),
        }))
      )
      .onConflictDoNothing();
  }

  // 4) Vincular la cotización al proyecto (una sola vez por cotización).
  await db
    .insert(schema.projectQuote)
    .values({
      id: newId("projectQuote"),
      organizationId,
      projectId,
      quoteId: quote.id,
    })
    .onConflictDoNothing();

  // 5) Volcar las partidas de la cotización al expediente del proyecto.
  if (items.length) {
    const [{ maxPos } = { maxPos: null }] = await db
      .select({ maxPos: schema.projectItem.position })
      .from(schema.projectItem)
      .where(
        scoped(
          schema.projectItem.organizationId,
          organizationId,
          eq(schema.projectItem.projectId, projectId)
        )
      )
      .orderBy(desc(schema.projectItem.position))
      .limit(1);
    const nextPos = (maxPos ?? -1) + 1;
    await db.insert(schema.projectItem).values(
      items.map((item: { name: string; description: string | null; quantity: number; unitPrice: number; productId: string | null }, idx: number) => ({
        id: newId("projectItem"),
        organizationId,
        projectId,
        name: item.name,
        description: item.description ?? null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        productId: item.productId,
        position: nextPos + idx,
      }))
    );
  }

  // 6) Orden de servicio (idempotente por cotización).
  const order = await ensureServiceOrderTx(db, {
    organizationId,
    projectId,
    quoteId: quote.id,
    contactId: quote.contactId,
    title: `Orden de ${quote.quoteNumber}`,
    createdBy: params.actorUserId ?? null,
  });

  // 7) Tareas iniciales del proceso — solo al crear el proyecto, para no
  //    duplicarlas con cotizaciones complementarias.
  if (projectCreated) {
    for (const tpl of template.tasks) {
      const taskId = newId("projectTask");
      await db.insert(schema.projectTask).values({
        id: taskId,
        organizationId,
        projectId,
        title: tpl.title,
        description: tpl.description ?? null,
        estado: "no_empezado",
      });
      taskIds.push(taskId);
    }
  }

  const [orderRow] = await db
    .select({ code: schema.serviceOrder.code })
    .from(schema.serviceOrder)
    .where(
      scoped(
        schema.serviceOrder.organizationId,
        organizationId,
        eq(schema.serviceOrder.id, order.id)
      )
    )
    .limit(1);

  return {
    projectId,
    serviceOrderId: order.id,
    projectCreated,
    serviceOrderCreated: order.created,
    projectCode,
    serviceOrderCode: orderRow?.code ?? "",
    taskIds,
  };
}
