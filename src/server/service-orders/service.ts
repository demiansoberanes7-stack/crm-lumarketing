/**
 * Órdenes de servicio — la unidad operativa derivada de una cotización
 * aceptada. Rastreable hasta su proyecto, cotización y cliente.
 *
 * Reglas:
 *  - Una cotización genera **a lo sumo una** orden de servicio (idempotente por
 *    `unique(organizationId, quoteId)`): reprocesar la aceptación no duplica.
 *  - Los renglones y tareas no se copian aquí; viven en `project_item` y
 *    `project_task`, ligados al proyecto.
 *  - Cada cambio de estado deja un registro en `service_order_event` (no se
 *    borra historial).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { publishWebhook } from "@/server/webhooks/dispatcher";
import {
  canTransitionServiceOrder,
  isServiceOrderStatus,
  type ServiceOrderStatus,
} from "@/lib/service-order";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Código secuencial OS-XXXX con advisory lock (evita race condition). */
export async function nextServiceOrderCode(
  db: Db,
  organizationId: string
): Promise<string> {
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${organizationId + ":service_orders"}))`
  );
  const last = await db
    .select({ code: schema.serviceOrder.code })
    .from(schema.serviceOrder)
    .where(scoped(schema.serviceOrder.organizationId, organizationId))
    .orderBy(desc(schema.serviceOrder.createdAt))
    .limit(1);
  if (last[0]) {
    const num = parseInt(last[0].code.replace("OS-", ""), 10);
    if (!Number.isNaN(num)) return `OS-${String(num + 1).padStart(4, "0")}`;
  }
  return "OS-0001";
}

export interface EnsureServiceOrderInput {
  organizationId: string;
  projectId: string;
  quoteId?: string | null;
  contactId?: string | null;
  title: string;
  description?: string | null;
  status?: ServiceOrderStatus;
  priority?: string | null;
  assignedUserId?: string | null;
  createdBy?: string | null;
}

/**
 * Asegura la orden de servicio de una cotización dentro de una transacción.
 * Idempotente: si ya existe para (org, quoteId) la devuelve sin duplicar.
 * Si `quoteId` es null, siempre crea una nueva.
 */
export async function ensureServiceOrderTx(
  db: Db,
  input: EnsureServiceOrderInput
): Promise<{ id: string; created: boolean }> {
  if (input.quoteId) {
    const [existing] = await db
      .select({ id: schema.serviceOrder.id })
      .from(schema.serviceOrder)
      .where(
        scoped(
          schema.serviceOrder.organizationId,
          input.organizationId,
          eq(schema.serviceOrder.quoteId, input.quoteId)
        )
      )
      .limit(1);
    if (existing) return { id: existing.id, created: false };
  }

  const id = newId("serviceOrder");
  const code = await nextServiceOrderCode(db, input.organizationId);
  await db.insert(schema.serviceOrder).values({
    id,
    organizationId: input.organizationId,
    code,
    projectId: input.projectId,
    quoteId: input.quoteId ?? null,
    contactId: input.contactId ?? null,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? "pendiente",
    priority: input.priority ?? null,
    assignedUserId: input.assignedUserId ?? null,
    createdBy: input.createdBy ?? null,
  });
  await db.insert(schema.serviceOrderEvent).values({
    id: newId("serviceOrderEvent"),
    organizationId: input.organizationId,
    serviceOrderId: id,
    fromStatus: null,
    toStatus: input.status ?? "pendiente",
    actorId: input.createdBy ?? null,
    notes: "Orden creada desde cotización aceptada",
  });
  return { id, created: true };
}

/** Órdenes de servicio de un proyecto (o de toda la organización). */
export async function listServiceOrders(
  organizationId: string,
  opts?: { projectId?: string; status?: string }
) {
  const conditions = [scoped(schema.serviceOrder.organizationId, organizationId)];
  if (opts?.projectId) conditions.push(eq(schema.serviceOrder.projectId, opts.projectId));
  if (opts?.status) conditions.push(eq(schema.serviceOrder.status, opts.status));
  return getDb()
    .select()
    .from(schema.serviceOrder)
    .where(and(...conditions))
    .orderBy(desc(schema.serviceOrder.createdAt));
}

export async function getServiceOrder(organizationId: string, orderId: string) {
  const [order] = await getDb()
    .select()
    .from(schema.serviceOrder)
    .where(
      scoped(
        schema.serviceOrder.organizationId,
        organizationId,
        eq(schema.serviceOrder.id, orderId)
      )
    )
    .limit(1);
  if (!order) return null;
  const events = await getDb()
    .select()
    .from(schema.serviceOrderEvent)
    .where(
      scoped(
        schema.serviceOrderEvent.organizationId,
        organizationId,
        eq(schema.serviceOrderEvent.serviceOrderId, orderId)
      )
    )
    .orderBy(desc(schema.serviceOrderEvent.createdAt));
  return { ...order, events };
}

/** Cambiar el estado de una orden de servicio (valida transición y deja bitácora). */
export async function updateServiceOrderStatus(
  organizationId: string,
  orderId: string,
  nextStatus: ServiceOrderStatus,
  actorId?: string | null
): Promise<void> {
  if (!isServiceOrderStatus(nextStatus)) throw new Error("Estado de orden no válido");

  const changed = await getDb().transaction(async (db) => {
    const [order] = await db
      .select()
      .from(schema.serviceOrder)
      .where(
        scoped(
          schema.serviceOrder.organizationId,
          organizationId,
          eq(schema.serviceOrder.id, orderId)
        )
      )
      .limit(1)
      .for("update");
    if (!order) throw new Error("Orden de servicio no encontrada");

    const from = order.status as ServiceOrderStatus;
    if (!isServiceOrderStatus(from)) throw new Error("Estado actual inválido");
    if (from === nextStatus) return { code: order.code, from, noop: true };
    if (!canTransitionServiceOrder(from, nextStatus)) {
      throw new Error(`Transición no permitida: ${from} → ${nextStatus}`);
    }

    await db
      .update(schema.serviceOrder)
      .set({
        status: nextStatus,
        updatedAt: new Date(),
        deliveredAt: nextStatus === "entregada" ? new Date() : order.deliveredAt,
      })
      .where(eq(schema.serviceOrder.id, orderId));

    await db.insert(schema.serviceOrderEvent).values({
      id: newId("serviceOrderEvent"),
      organizationId,
      serviceOrderId: orderId,
      fromStatus: from,
      toStatus: nextStatus,
      actorId: actorId ?? null,
    });

    return { code: order.code, from, noop: false };
  });

  if (!changed.noop) {
    publishWebhook(organizationId, "service_order.status_changed", {
      serviceOrderId: orderId,
      code: changed.code,
      from: changed.from,
      to: nextStatus,
    });
  }
}
