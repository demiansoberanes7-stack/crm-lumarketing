/** Run only in an ephemeral audit_e2e_* database; invoked by the local self-test. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { getDb, getSql, schema } from "@/lib/db";
import { buildDashboard, type DashboardInput } from "@/server/dashboard/metrics";
import { queryDashboard } from "@/server/dashboard/query";
import { graphRequest } from "@/lib/meta/client";

assert(new URL(process.env.DATABASE_URL!).pathname.startsWith("/audit_e2e_"), "Requires disposable audit_e2e_* DB");
const db = getDb();
const now = new Date("2026-09-21T12:00:00Z");
const date = (s: string) => new Date(`${s}T00:00:00Z`);
const empty = (): DashboardInput => ({ projects: [], stages: [], stageEvents: [], tasks: [], quotes: [], charges: [], payments: [], expenses: [], conversations: [], contacts: [], members: [] });

// Arrays of groups have no semantic ordering; floating ratios may differ in their
// final IEEE-754 digit between PostgreSQL numeric and JavaScript arithmetic.
function canonical(value: unknown): unknown {
  if (typeof value === "number") return Number(value.toFixed(8));
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}

async function fixture(org: string): Promise<DashboardInput> {
  const organizationId = org;
  await db.insert(schema.organization).values({ id: org, name: org, slug: org, createdAt: now });
  const result = empty();
  result.contacts = await db.insert(schema.contact).values([
    { id: `${org}-ct`, organizationId, waIdentity: "525512340000", name: "Cliente", source: "web", createdAt: date("2026-09-20") },
    { id: `${org}-old`, organizationId, waIdentity: "525512340001", name: "Anterior", source: null, createdAt: date("2025-01-01") },
    { id: `${org}-archived`, organizationId, waIdentity: "525512340002", name: "Archivado", archivedAt: now, createdAt: now },
    { id: `${org}-future`, organizationId, waIdentity: "525512340003", name: "Futuro", createdAt: date("2026-09-22") },
  ]).returning();
  result.stages = await db.insert(schema.projectStage).values([
    { id: `${org}-a`, organizationId, name: "Diseño", position: 0 },
    { id: `${org}-b`, organizationId, name: "Entrega", position: 1 },
  ]).returning();
  result.projects = await db.insert(schema.project).values([
    { id: `${org}-p`, organizationId, code: "P1", name: "Activo", estado: "activo", avance: 50, riesgo: "alto", contactId: `${org}-ct`, stageId: `${org}-b`, createdAt: date("2026-08-01") },
    { id: `${org}-p2`, organizationId, code: "P2", name: "Cerrado", estado: "cerrado", createdAt: date("2026-01-01") },
    { id: `${org}-p3`, organizationId, code: "P3", name: "Archivado", archivedAt: now, createdAt: date("2026-01-01") },
    { id: `${org}-p4`, organizationId, code: "P4", name: "Futuro", createdAt: date("2026-09-22") },
  ]).returning();
  result.stageEvents = await db.insert(schema.projectStageEvent).values([
    { id: `${org}-e1`, organizationId, projectId: `${org}-p`, fromStageId: null, toStageId: `${org}-a`, toStageName: "Diseño", createdAt: date("2026-08-02") },
    { id: `${org}-e2`, organizationId, projectId: `${org}-p`, fromStageId: `${org}-a`, toStageId: `${org}-a`, toStageName: "Diseño", createdAt: date("2026-09-01") },
    { id: `${org}-e3`, organizationId, projectId: `${org}-p`, fromStageId: `${org}-a`, toStageId: `${org}-b`, toStageName: "Entrega", createdAt: date("2026-09-19") },
    { id: `${org}-e4`, organizationId, projectId: `${org}-p`, fromStageId: `${org}-b`, toStageId: null, toStageName: "Eliminada", createdAt: date("2026-09-22") },
  ]).returning();
  result.tasks = await db.insert(schema.projectTask).values([
    { id: `${org}-t1`, organizationId, projectId: `${org}-p`, title: "Vencida", priority: "alta", dueDate: date("2026-09-20"), createdAt: date("2026-09-01"), updatedAt: now },
    { id: `${org}-t2`, organizationId, projectId: `${org}-p`, title: "Hoy", estado: "no_empezado", dueDate: date("2026-09-21"), createdAt: date("2026-09-01"), updatedAt: now },
    { id: `${org}-t3`, organizationId, projectId: `${org}-p`, title: "Completada", estado: "terminado", createdAt: date("2026-09-01"), updatedAt: now },
    { id: `${org}-t4`, organizationId, projectId: `${org}-p3`, title: "Archivada", createdAt: date("2026-09-01"), updatedAt: now },
  ]).returning();
  result.quotes = await db.insert(schema.quote).values([
    ...["accepted", "sent", "draft", "rejected", "expired"].map((status, i) => ({ id: `${org}-q${i}`, organizationId, quoteNumber: `Q${i}`, status, total: 10001 + i, discountAmount: 250, createdAt: date("2026-09-20"), validUntil: i === 1 ? date("2026-09-19") : null })),
    { id: `${org}-usd`, organizationId, quoteNumber: "USD", currency: "USD", total: 99999, createdAt: now },
    { id: `${org}-old-q`, organizationId, quoteNumber: "Old", total: 99999, createdAt: date("2025-01-01") },
  ]).returning();
  result.charges = await db.insert(schema.charge).values([
    { id: `${org}-c1`, organizationId, concept: "Saldo", totalAmount: 10000, paidAmount: 6000, dueDate: date("2026-09-20"), createdAt: date("2026-01-01") },
    { id: `${org}-c2`, organizationId, concept: "Futuro pagado", totalAmount: 10000, paidAmount: 10000, status: "pagado", dueDate: date("2026-06-01"), createdAt: date("2026-01-01") },
    { id: `${org}-c3`, organizationId, concept: "USD", quoteId: `${org}-usd`, totalAmount: 99999, createdAt: date("2026-01-01") },
    { id: `${org}-c4`, organizationId, concept: "Cancelada", status: "cancelado", totalAmount: 99999, createdAt: date("2026-01-01") },
    { id: `${org}-c5`, organizationId, concept: "Saldo hoy", totalAmount: 3000, dueDate: date("2026-09-21"), createdAt: date("2026-01-01") },
  ]).returning();
  result.payments = await db.insert(schema.payment).values([
    { id: `${org}-pay1`, organizationId, chargeId: `${org}-c1`, monto: 6000, metodo: "transferencia", comprobanteUrl: " local-receipt ", fecha: date("2026-09-20") },
    { id: `${org}-pay2`, organizationId, chargeId: `${org}-c2`, monto: 10000, metodo: "transferencia", fecha: date("2026-09-22") },
    { id: `${org}-pay3`, organizationId, chargeId: `${org}-c3`, monto: 99999, metodo: "tarjeta", fecha: now },
    { id: `${org}-pay4`, organizationId, monto: 55, metodo: "efectivo", fecha: date("2026-09-15") },
    { id: `${org}-pay5`, organizationId, monto: 2222, metodo: "efectivo", fecha: date("2026-01-01") },
  ]).returning();
  result.expenses = await db.insert(schema.expense).values([
    { id: `${org}-exp1`, organizationId, descripcion: "Servicio", categoria: "servicios", proveedor: " Proveedor ", monto: 235, metodo: "efectivo", fecha: date("2026-09-20") },
    { id: `${org}-exp2`, organizationId, descripcion: "Anterior", categoria: "servicios", monto: 100, metodo: "efectivo", fecha: date("2026-01-01") },
    { id: `${org}-exp3`, organizationId, descripcion: "Futuro", categoria: "servicios", monto: 99999, metodo: "efectivo", fecha: date("2026-09-22") },
  ]).returning();
  result.conversations = await db.insert(schema.conversation).values([
    { id: `${org}-cv1`, organizationId, contactId: `${org}-ct`, lastMessageAt: now },
    { id: `${org}-cv2`, organizationId, contactId: `${org}-old`, isTest: true, lastMessageAt: now },
    { id: `${org}-cv3`, organizationId, contactId: `${org}-old`, lastMessageAt: date("2026-01-01"), channel: "messenger" },
  ]).returning();
  return result;
}

try {
  assert.equal(new URL(process.env.META_GRAPH_BASE_URL!).hostname, "127.0.0.1");
  assert.deepEqual(await graphRequest("audit-happy", { token: "local-fake-token" }), { id: "local-meta-message" });
  const timeoutStarted = performance.now();
  await Promise.all(["headers", "body"].map((phase) => assert.rejects(
    graphRequest(`audit-stall-${phase}`, { method: "POST", token: "local-fake-token", body: { text: "Local only" } }),
    (error: unknown) => error instanceof Error && error.name === "MetaApiError" && error.message.includes("tardó demasiado")
  )));
  assert(performance.now() - timeoutStarted < 30000, "Both stalled requests terminate without hanging");
  console.log("OK: real HTTP mock, successful Meta call and 20-second deadlines for stalled headers/body");
  const input = await fixture("audit-a");
  await fixture("audit-b"); // Identical second tenant must not double any metric.
  for (const period of ["7d", "30d", "90d", "1y"]) {
    assert.deepEqual(canonical(await queryDashboard("audit-a", period, now)), canonical(buildDashboard(input, period, now)), `SQL matches reference for ${period}`);
    assert.deepEqual(canonical(await queryDashboard("absent-tenant", period, now)), canonical(buildDashboard(empty(), period, now)));
  }
  console.log("OK: dashboard SQL/reference, 4 periods, empty state, currencies, future payments, stage history and tenant isolation");

  // Existing-install upgrade: restore historical FK, create booking, apply the
  // actual migration twice, and verify all history survives contact deletion.
  await db.execute(sql`alter table booking drop constraint booking_contact_id_contact_id_fk`);
  await db.execute(sql`alter table booking add constraint booking_contact_id_contact_id_fk foreign key (contact_id) references contact(id) on delete cascade`);
  await db.execute(sql`insert into booking (id, organization_id, contact_id, scheduled_at, duration_minutes, notes) values ('audit-booking', 'audit-a', 'audit-a-ct', '2026-09-22', 30, 'Conservar historia')`);
  const migration = await readFile("drizzle/0017_booking_preserve_contact_history.sql", "utf8");
  for (let i = 0; i < 2; i++) await getSql().begin(async (tx) => { await tx.unsafe(migration); });
  await db.delete(schema.contact).where(eq(schema.contact.id, "audit-a-ct"));
  const [booking] = await db.execute(sql`select contact_id, notes from booking where id = 'audit-booking'`);
  assert.equal(booking?.contact_id, null);
  assert.equal(booking?.notes, "Conservar historia");
  console.log("OK: upgrade migration is repeatable and preserves booking history");

  await db.execute(sql`insert into contact (id, organization_id, wa_identity, name, created_at) select 'load-' || n, 'audit-b', 'load-' || n, 'Carga', '2026-09-20'::timestamp from generate_series(1, 10000) n`);
  const started = performance.now();
  const large = await queryDashboard("audit-b", "30d", now);
  assert.equal(large.contacts.total, 10002);
  assert(JSON.stringify(large).length < 15000, "Response contains aggregates, not raw records");
  console.log(`OK: 10,000 extra contacts, aggregate response ${JSON.stringify(large).length} bytes, ${Math.round(performance.now() - started)}ms locally`);
} finally {
  await db.delete(schema.organization).where(eq(schema.organization.id, "audit-a"));
  await db.delete(schema.organization).where(eq(schema.organization.id, "audit-b"));
  await getSql().end();
}
