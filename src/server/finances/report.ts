import { eq, gte, lte, desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
export function reportPeriod(search: URLSearchParams) {
  const now = new Date();
  const start = search.get("from"); const end = search.get("to");
  if (!!start !== !!end) throw new Error("Indica ambas fechas");
  const from = start ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const to = end ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  for (const value of [from, to]) {
    const date = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Fecha no válida");
  }
  if (from > to) throw new Error("La fecha inicial debe ser anterior a la final");
  return { from: new Date(`${from}T00:00:00Z`), to: new Date(`${to}T23:59:59.999Z`) };
}
export async function financialReport(organizationId: string, period: { from: Date; to: Date }) {
  return getDb().transaction(async (db) => {
    const payments = await db.select().from(schema.payment).where(scoped(schema.payment.organizationId, organizationId, gte(schema.payment.fecha, period.from), lte(schema.payment.fecha, period.to))).orderBy(desc(schema.payment.fecha));
    const expenses = await db.select().from(schema.expense).where(scoped(schema.expense.organizationId, organizationId, gte(schema.expense.fecha, period.from), lte(schema.expense.fecha, period.to))).orderBy(desc(schema.expense.fecha));
    const charges = await db.select().from(schema.charge).where(scoped(schema.charge.organizationId, organizationId));
    const ingresos = payments.reduce((total, p) => total + p.monto, 0);
    const egresos = expenses.reduce((total, p) => total + p.monto, 0);
    return { balance: { ingresos, egresos, balance: ingresos - egresos, periodo: period }, pagosRecientes: payments, gastosRecientes: expenses, cuentasPorCobrar: charges.filter((c) => c.status !== "cancelado" && c.totalAmount > c.paidAmount) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export async function validContact(organizationId: string, contactId: string) {
  const [contact] = await getDb().select({ id: schema.contact.id }).from(schema.contact).where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)));
  return !!contact;
}
