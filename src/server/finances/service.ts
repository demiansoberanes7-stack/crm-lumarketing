/**
 * Finance Service — balance general, KPIs, ingresos y egresos.
 *
 * Calcula totales de pagos (ingresos), gastos, saldos por cliente y cotización.
 * Moneda única de branding.currency (MXN por defecto).
 */
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { createHash } from "node:crypto";

export type BalancePeriod = {
  from: Date;
  to: Date;
};

/** Obtener rango de fechas del mes actual */
export function currentMonthRange(): BalancePeriod {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { from, to };
}

/** KPIs del mes actual: ingresos, egresos, balance */
export async function getMonthlyBalance(organizationId: string) {
  const db = getDb();
  const { from, to } = currentMonthRange();

  const [ingresos] = await db
    .select({ total: sql<number>`COALESCE(SUM(${schema.payment.monto}), 0)` })
    .from(schema.payment)
    .where(
      and(
        scoped(schema.payment.organizationId, organizationId),
        gte(schema.payment.fecha, from),
        lte(schema.payment.fecha, to)
      )
    );

  const [egresos] = await db
    .select({ total: sql<number>`COALESCE(SUM(${schema.expense.monto}), 0)` })
    .from(schema.expense)
    .where(
      and(
        scoped(schema.expense.organizationId, organizationId),
        gte(schema.expense.fecha, from),
        lte(schema.expense.fecha, to)
      )
    );

  return {
    ingresos: Number(ingresos?.total ?? 0),
    egresos: Number(egresos?.total ?? 0),
    balance: Number(ingresos?.total ?? 0) - Number(egresos?.total ?? 0),
    periodo: { from, to },
  };
}

/** Balance por rango de fechas personalizado */
export async function getBalanceByPeriod(organizationId: string, from: Date, to: Date) {
  const db = getDb();

  const [ingresos] = await db
    .select({ total: sql<number>`COALESCE(SUM(${schema.payment.monto}), 0)` })
    .from(schema.payment)
    .where(
      and(
        scoped(schema.payment.organizationId, organizationId),
        gte(schema.payment.fecha, from),
        lte(schema.payment.fecha, to)
      )
    );

  const [egresos] = await db
    .select({ total: sql<number>`COALESCE(SUM(${schema.expense.monto}), 0)` })
    .from(schema.expense)
    .where(
      and(
        scoped(schema.expense.organizationId, organizationId),
        gte(schema.expense.fecha, from),
        lte(schema.expense.fecha, to)
      )
    );

  return {
    ingresos: Number(ingresos?.total ?? 0),
    egresos: Number(egresos?.total ?? 0),
    balance: Number(ingresos?.total ?? 0) - Number(egresos?.total ?? 0),
    periodo: { from, to },
  };
}

/** Cuentas por cobrar pendientes */
export async function getAccountsReceivable(organizationId: string) {
  const db = getDb();

  const charges = await db
    .select()
    .from(schema.charge)
    .where(
      and(
        scoped(schema.charge.organizationId, organizationId),
        sql`${schema.charge.status} IN ('pendiente', 'parcial')`
      )
    )
    .orderBy(schema.charge.dueDate);

  return charges.map((c) => ({
    ...c,
    saldoPendiente: c.totalAmount - c.paidAmount,
  }));
}

/** Pagos recientes */
export async function getRecentPayments(organizationId: string, limit = 20) {
  const db = getDb();
  return db
    .select()
    .from(schema.payment)
    .where(scoped(schema.payment.organizationId, organizationId))
    .orderBy(desc(schema.payment.fecha))
    .limit(limit);
}

/** Gastos recientes */
export async function getRecentExpenses(organizationId: string, limit = 20) {
  const db = getDb();
  return db
    .select()
    .from(schema.expense)
    .where(scoped(schema.expense.organizationId, organizationId))
    .orderBy(desc(schema.expense.fecha))
    .limit(limit);
}

/** Registrar un pago (ingreso) */
export async function createPayment(
  organizationId: string,
  input: {
    chargeId?: string;
    contactId?: string;
    monto: number;
    metodo: string;
    referencia?: string;
    comprobanteUrl?: string;
    notas?: string;
    fecha?: Date;
    requestId?: string;
  },
  createdBy?: string
): Promise<string> {
  return getDb().transaction(async (db) => {
  const id = input.requestId ? `pay_${createHash("sha256").update(`${organizationId}:${input.requestId}`).digest("hex").slice(0, 40)}` : newId("payment");
  if (input.contactId) {
    const [contact] = await db.select({ id: schema.contact.id }).from(schema.contact).where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, input.contactId)));
    if (!contact) throw new Error("Contacto no válido");
  }
  const [inserted] = await db.insert(schema.payment).values({
    id,
    organizationId,
    chargeId: input.chargeId ?? null,
    contactId: input.contactId ?? null,
    fecha: input.fecha ?? new Date(),
    monto: input.monto,
    metodo: input.metodo,
    referencia: input.referencia ?? null,
    comprobanteUrl: input.comprobanteUrl ?? null,
    notas: input.notas ?? null,
    createdBy: createdBy ?? null,
  }).onConflictDoNothing().returning({ id: schema.payment.id });
  if (!inserted) return id;

  // Actualizar saldo de la cuenta por cobrar
  if (input.chargeId) {
    const [charge] = await db
      .select()
      .from(schema.charge)
      .where(scoped(schema.charge.organizationId, organizationId, eq(schema.charge.id, input.chargeId)))
      .limit(1).for("update");

    if (!charge) throw new Error("Cuenta por cobrar no válida");
    if (charge.status === "cancelado" || input.monto > charge.totalAmount - charge.paidAmount) throw new Error("El pago supera el saldo pendiente o la cuenta está cancelada");
    const newPaid = charge.paidAmount + input.monto;
    const newStatus = newPaid >= charge.totalAmount ? "pagado" : "parcial";
    await db
      .update(schema.charge)
      .set({ paidAmount: newPaid, status: newStatus, updatedAt: new Date() })
      .where(eq(schema.charge.id, input.chargeId));
  }

  return id;
  });
}

/** Registrar un gasto */
export async function createExpense(
  organizationId: string,
  input: {
    descripcion: string;
    categoria: string;
    proveedor?: string;
    monto: number;
    metodo: string;
    referencia?: string;
    comprobanteUrl?: string;
    notas?: string;
    fecha?: Date;
  },
  createdBy?: string
): Promise<string> {
  const db = getDb();
  const id = newId("expense");

  await db.insert(schema.expense).values({
    id,
    organizationId,
    fecha: input.fecha ?? new Date(),
    descripcion: input.descripcion,
    categoria: input.categoria,
    proveedor: input.proveedor ?? null,
    monto: input.monto,
    metodo: input.metodo,
    referencia: input.referencia ?? null,
    comprobanteUrl: input.comprobanteUrl ?? null,
    notas: input.notas ?? null,
    createdBy: createdBy ?? null,
  });

  return id;
}

/** Crear cuenta por cobrar desde cotización aceptada (idempotente) */
export async function createChargeFromQuote(
  organizationId: string,
  quoteId: string
): Promise<string> {
  const db = getDb();

  // Verificar si ya existe una cuenta por cobrar para esta cotización
  const [existing] = await db
    .select({ id: schema.charge.id })
    .from(schema.charge)
    .where(scoped(schema.charge.organizationId, organizationId, eq(schema.charge.quoteId, quoteId)))
    .limit(1);
  if (existing) return existing.id;

  const id = newId("charge");

  const [quote] = await db
    .select()
    .from(schema.quote)
    .where(scoped(schema.quote.organizationId, organizationId, eq(schema.quote.id, quoteId)))
    .limit(1);

  if (!quote) throw new Error("Cotización no encontrada");

  await db.insert(schema.charge).values({
    id,
    organizationId,
    quoteId,
    contactId: quote.contactId,
    concept: `Cotización ${quote.quoteNumber}`,
    totalAmount: quote.total,
    paidAmount: 0,
    status: "pendiente",
  });

  return id;
}
