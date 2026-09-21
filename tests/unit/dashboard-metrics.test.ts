import { describe, it, expect } from "vitest";
import { buildDashboard, dashboardRange, weekKey, type DashboardInput } from "@/server/dashboard/metrics";

const now = new Date("2026-09-21T12:00:00Z");
const d = (value: string) => new Date(`${value}T00:00:00Z`);
const empty = (): DashboardInput => ({ projects: [], stages: [], stageEvents: [], tasks: [], quotes: [], charges: [], payments: [], expenses: [], conversations: [], contacts: [], members: [] });
// Fixtures only fill fields consumed by the metrics, allowing each business case to stay readable.
const project = (extra = {}) => ({ id: "p", estado: "activo", avance: 50, createdAt: d("2026-01-01"), archivedAt: null, ...extra }) as DashboardInput["projects"][number];
const quote = (extra = {}) => ({ id: "q", currency: "MXN", status: "sent", createdAt: d("2026-09-20"), archivedAt: null, total: 10000, discountAmount: 1000, ...extra }) as DashboardInput["quotes"][number];
const payment = (extra = {}) => ({ id: "pay", fecha: d("2026-09-20"), monto: 10000, metodo: "transferencia", ...extra }) as DashboardInput["payments"][number];
const charge = (extra = {}) => ({ id: "c", totalAmount: 10000, paidAmount: 0, createdAt: d("2026-01-01"), status: "pendiente", dueDate: d("2026-09-20"), quoteId: null, ...extra }) as DashboardInput["charges"][number];

describe("dashboard: fórmulas de negocio", () => {
  it("incluye días calendario UTC y usa lunes para semanas sin depender del horario de la transacción", () => {
    expect(dashboardRange("7d", now).from.toISOString()).toBe("2026-09-15T00:00:00.000Z");
    expect(weekKey(new Date("2026-09-20T23:59:59Z"))).toBe("2026-09-14");
    expect(weekKey(now)).toBe("2026-09-21");
  });
  it("suma caja en centavos, excluye futuros y conserva TODO el año en las series", () => {
    const input = empty();
    input.payments = [payment({ fecha: d("2026-01-02"), monto: 12345 }), payment({ fecha: d("2026-09-22") }), payment({ monto: 55 })];
    input.expenses = [{ fecha: d("2026-02-01"), monto: 2000, categoria: "servicios" }] as DashboardInput["expenses"];
    const result = buildDashboard(input, "1y", now);
    expect(result.payments.grossIncome).toBe(12400);
    expect(result.profitability.netIncome).toBe(10400);
    expect(result.profitability.weeklyCashFlow.length).toBeGreaterThan(50);
    expect(result.profitability.weeklyCashFlow.reduce((n, w) => n + w.net, 0)).toBe(10400);
    expect(result.payments.byMonth.reduce((n, m) => n + m.amount, 0)).toBe(12400);
  });
  it("el límite inicial incluye medianoche y rechaza tanto el día anterior como fechas futuras", () => {
    const input = empty();
    input.payments = [payment({ fecha: d("2026-09-14") }), payment({ fecha: d("2026-09-15") }), payment({ fecha: new Date("2026-09-21T12:00:01Z") })];
    expect(buildDashboard(input, "7d", now).payments.count).toBe(1);
  });
  it("aprobación incluye rechazadas/expiradas, y mes y total tienen el mismo denominador", () => {
    const input = empty();
    input.quotes = [quote({ status: "accepted" }), quote({ status: "rejected" }), quote({ status: "expired" }), quote(), quote({ status: "draft" }), quote({ archivedAt: now }), quote({ currency: "USD" })];
    const result = buildDashboard(input, "30d", now).quotes;
    expect(result.total).toBe(5);
    expect(result.sent).toBe(4);
    expect(result.approvalRate).toBe(25);
    expect(result.byMonth.reduce((n, m) => n + m.sent, 0)).toBe(result.sent);
    expect(result.pipelineValue).toBe(20000);
    expect(result.excludedCurrency).toBe(1);
  });
  it("cartera excluye canceladas/sobrepagadas y mora es sobre saldo, no número histórico de cuentas", () => {
    const input = empty();
    input.charges = [charge({ paidAmount: 4000 }), charge({ id: "hoy", dueDate: d("2026-09-21"), totalAmount: 4000 }), charge({ id: "cancel", status: "cancelado" }), charge({ id: "extra", paidAmount: 12000 })];
    const result = buildDashboard(input, "7d", now).receivables;
    expect(result.totalPending).toBe(10000);
    expect(result.overdueAmount).toBe(6000);
    expect(result.overdueRate).toBe(60);
    expect(result.overdueCount).toBe(1);
    expect(result.aging.reduce((n, a) => n + a.amount, 0)).toBe(result.overdueAmount);
  });
  it("un pago futuro no reduce el saldo disponible hoy", () => {
    const input = empty(); input.charges = [charge({ paidAmount: 10000, status: "pagado" })];
    input.payments = [payment({ chargeId: "c", fecha: d("2026-09-22") })];
    const result = buildDashboard(input, "7d", now);
    expect(result.receivables.totalPending).toBe(10000);
    expect(result.payments.grossIncome).toBe(0);
  });
  it("promedia 3 estancias completas correctamente y las atribuye a la etapa abandonada", () => {
    const input = empty();
    input.projects = [project({ id: "p1", createdAt: d("2026-09-01") }), project({ id: "p2", createdAt: d("2026-09-01") }), project({ id: "p3", createdAt: d("2026-09-01") })];
    input.stages = [{ id: "a", name: "Diseño" }, { id: "b", name: "Entrega" }] as DashboardInput["stages"];
    input.stageEvents = [2, 4, 12].map((days, i) => ({ projectId: `p${i + 1}`, fromStageId: "a", toStageId: "b", createdAt: new Date(d("2026-09-01").getTime() + days * 86400000) })) as DashboardInput["stageEvents"];
    expect(buildDashboard(input, "30d", now).projects.avgTimeByStage).toEqual([{ stage: "Diseño", avgDays: 6 }]);
  });
  it("separa vencidas de próximas, excluye archivados y no cuenta terminadas sin asignar", () => {
    const input = empty(); input.projects = [project(), project({ id: "archive", archivedAt: now })];
    input.tasks = [
      { projectId: "p", estado: "pendiente", dueDate: d("2026-09-20") },
      { projectId: "p", estado: "pendiente", dueDate: d("2026-09-21") },
      { projectId: "p", estado: "terminado", dueDate: d("2026-09-20") },
      { projectId: "archive", estado: "pendiente", dueDate: d("2026-09-21") },
    ].map((t) => ({ ...t, createdAt: d("2026-09-01"), updatedAt: now, assigneeId: null })) as DashboardInput["tasks"];
    const result = buildDashboard(input, "7d", now).tasks;
    expect(result.total).toBe(3); expect(result.overdue).toBe(1); expect(result.pendingDueSoon).toBe(1); expect(result.unassigned).toBe(2);
  });
  it("no inventa retención y excluye conversaciones de pruebas y actividad fuera del período", () => {
    const input = empty();
    input.conversations = [{ isTest: true, lastMessageAt: now, channel: "whatsapp" }, { isTest: false, lastMessageAt: d("2026-09-10"), channel: "instagram" }, { isTest: false, lastMessageAt: now, channel: "whatsapp" }] as DashboardInput["conversations"];
    const result = buildDashboard(input, "7d", now);
    expect(result.inbox.active).toBe(1); expect(result.inbox.byChannel).toEqual([{ name: "whatsapp", count: 1 }]);
    expect(result.contacts.activityRate).toBeNull(); expect(result.contacts).not.toHaveProperty("retentionRate");
    expect(result.profitability.margin).toBeNull(); expect(result.quotes.approvalRate).toBeNull();
  });
});
