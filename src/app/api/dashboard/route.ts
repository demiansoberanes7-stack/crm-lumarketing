/**
 * Dashboard API — agrega todos los KPIs en una sola llamada.
 *
 * Soporta ?period=7d|30d|90d|1y (default: 30d)
 * Retorna el objeto completo que el dashboard consume.
 */
import { sql, and, gte, isNull } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

function periodRange(period: string): { from: Date; label: string } {
  const now = new Date();
  const d = new Date(now);
  switch (period) {
    case "7d": d.setDate(d.getDate() - 7); return { from: d, label: "Últimos 7 días" };
    case "90d": d.setDate(d.getDate() - 90); return { from: d, label: "Últimos 90 días" };
    case "1y": d.setFullYear(d.getFullYear() - 1); return { from: d, label: "Último año" };
    default: d.setDate(d.getDate() - 30); return { from: d, label: "Últimos 30 días" };
  }
}

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const period = url.searchParams.get("period") ?? "30d";
  const { from, label: periodLabel } = periodRange(period);
  const db = getDb();
  const orgId = session.organizationId;
  const org = scoped(schema.project.organizationId, orgId);

  // ─── A. PROYECTOS ──────────────────────────────
  const allProjects = await db.select().from(schema.project).where(org);
  const activeProjects = allProjects.filter((p) => !p.archivedAt);
  const archivedProjects = allProjects.filter((p) => p.archivedAt);
  const completedProjects = allProjects.filter((p) => p.estado === "cerrado" && p.avance === 100);

  const projectStages = await db.select().from(schema.projectStage).where(
    scoped(schema.projectStage.organizationId, orgId)
  );

  const projectsByStage = projectStages.map((s) => ({
    name: s.name,
    count: activeProjects.filter((p) => p.stageId === s.id).length,
  }));

  const projectsByAssignee = await db
    .select({ userId: schema.project.assignedUserId, count: sql<number>`count(*)::int` })
    .from(schema.project)
    .where(and(org, isNull(schema.project.archivedAt)))
    .groupBy(schema.project.assignedUserId);

  // Stage transition times
  const stageEvents = await db.select().from(schema.projectStageEvent).where(
    scoped(schema.projectStageEvent.organizationId, orgId)
  ).orderBy(schema.projectStageEvent.createdAt);

  const avgTimeByStage: { stage: string; avgDays: number }[] = [];
  const stagesByName = new Map(projectStages.map((s) => [s.id, s.name]));
  const eventsByProject = new Map<string, typeof stageEvents>();
  for (const ev of stageEvents) {
    const arr = eventsByProject.get(ev.projectId) ?? [];
    arr.push(ev);
    eventsByProject.set(ev.projectId, arr);
  }
  for (const events of eventsByProject.values()) {
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]!;
      const curr = events[i]!;
      const days = (new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime()) / 86400000;
      const stageName = stagesByName.get(curr.toStageId ?? "") ?? "Desconocido";
      const existing = avgTimeByStage.find((s) => s.stage === stageName);
      if (existing) {
        existing.avgDays = (existing.avgDays + days) / 2;
      } else {
        avgTimeByStage.push({ stage: stageName, avgDays: days });
      }
    }
  }

  const projects = {
    total: allProjects.length,
    active: activeProjects.length,
    archived: archivedProjects.length,
    completed: completedProjects.length,
    completionRate: allProjects.length > 0 ? (completedProjects.length / allProjects.length) * 100 : 0,
    avgAdvance: activeProjects.length > 0 ? activeProjects.reduce((s, p) => s + (p.avance ?? 0), 0) / activeProjects.length : 0,
    highRisk: activeProjects.filter((p) => p.riesgo === "alto").length,
    projectsByStage,
    projectsByAssignee: projectsByAssignee.map((r) => ({ name: r.userId ?? "Sin asignar", count: r.count })),
    avgTimeByStage,
  };

  // ─── B. TAREAS ─────────────────────────────────
  const allTasks = await db.select().from(schema.projectTask).where(
    scoped(schema.projectTask.organizationId, orgId)
  );

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const tasks = {
    total: allTasks.length,
    completed: allTasks.filter((t) => t.estado === "terminado").length,
    pending: allTasks.filter((t) => t.estado === "pendiente").length,
    notStarted: allTasks.filter((t) => t.estado === "no_empezado").length,
    completedThisWeek: allTasks.filter((t) => t.estado === "terminado" && new Date(t.updatedAt) >= weekAgo).length,
    pendingDueSoon: allTasks.filter((t) => t.estado !== "terminado" && t.dueDate && new Date(t.dueDate) < now).length,
    unassigned: allTasks.filter((t) => !t.assigneeId).length,
    byPriority: [
      { name: "Alta", count: allTasks.filter((t) => t.priority === "alta").length },
      { name: "Media", count: allTasks.filter((t) => t.priority === "media").length },
      { name: "Baja", count: allTasks.filter((t) => t.priority === "baja").length },
    ],
  };

  // ─── C. COTIZACIONES ───────────────────────────
  const periodQuotes = await db.select().from(schema.quote).where(
    and(scoped(schema.quote.organizationId, orgId), gte(schema.quote.createdAt, from))
  );
  const sentQuotes = periodQuotes.filter((q) => q.status === "sent" || q.status === "approved");
  const approvedQuotes = periodQuotes.filter((q) => q.status === "approved");

  const quotesByMonth = new Map<string, { sent: number; approved: number }>();
  for (const q of periodQuotes) {
    const month = new Date(q.createdAt).toISOString().slice(0, 7);
    const entry = quotesByMonth.get(month) ?? { sent: 0, approved: 0 };
    if (q.status === "sent") entry.sent++;
    if (q.status === "approved") entry.approved++;
    quotesByMonth.set(month, entry);
  }

  const quotes = {
    total: periodQuotes.length,
    sent: sentQuotes.length,
    approved: approvedQuotes.length,
    approvalRate: sentQuotes.length > 0 ? (approvedQuotes.length / sentQuotes.length) * 100 : 0,
    avgTicket: approvedQuotes.length > 0 ? approvedQuotes.reduce((s, q) => s + q.total, 0) / approvedQuotes.length : 0,
    pipelineValue: periodQuotes.filter((q) => q.status === "draft" || q.status === "sent").reduce((s, q) => s + q.total, 0),
    avgDiscount: approvedQuotes.length > 0
      ? approvedQuotes.reduce((s, q) => s + (q.discountAmount ?? 0), 0) / approvedQuotes.length
      : 0,
    byMonth: Array.from(quotesByMonth.entries()).map(([month, data]) => ({ month, ...data })).sort((a, b) => a.month.localeCompare(b.month)),
    byChannel: [
      { name: "WhatsApp", count: periodQuotes.filter((q) => q.sendChannel === "whatsapp").length },
      { name: "Email", count: periodQuotes.filter((q) => q.sendChannel === "email").length },
      { name: "Otro", count: periodQuotes.filter((q) => q.sendChannel && q.sendChannel !== "whatsapp" && q.sendChannel !== "email").length },
    ],
  };

  // ─── D. COBRANZA ────────────────────────────────
  const charges = await db.select().from(schema.charge).where(
    scoped(schema.charge.organizationId, orgId)
  );

  const pendingCharges = charges.filter((c) => c.status !== "pagado");
  const overdueCharges = pendingCharges.filter((c) => c.dueDate && new Date(c.dueDate) < now);

  const agingBuckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const c of overdueCharges) {
    const daysOverdue = Math.floor((now.getTime() - new Date(c.dueDate!).getTime()) / 86400000);
    if (daysOverdue <= 30) agingBuckets["0-30"] += (c.totalAmount - c.paidAmount);
    else if (daysOverdue <= 60) agingBuckets["31-60"] += (c.totalAmount - c.paidAmount);
    else if (daysOverdue <= 90) agingBuckets["61-90"] += (c.totalAmount - c.paidAmount);
    else agingBuckets["90+"] += (c.totalAmount - c.paidAmount);
  }

  const receivables = {
    totalPending: pendingCharges.reduce((s, c) => s + (c.totalAmount - c.paidAmount), 0),
    overdueCount: overdueCharges.length,
    overdueAmount: overdueCharges.reduce((s, c) => s + (c.totalAmount - c.paidAmount), 0),
    overdueRate: charges.length > 0 ? (overdueCharges.length / charges.length) * 100 : 0,
    aging: Object.entries(agingBuckets).map(([bucket, amount]) => ({ bucket, amount })),
    topDebtors: pendingCharges
      .sort((a, b) => (b.totalAmount - b.paidAmount) - (a.totalAmount - a.paidAmount))
      .slice(0, 10)
      .map((c) => ({ id: c.id, concept: c.concept, amount: c.totalAmount - c.paidAmount })),
  };

  // ─── E. PAGOS ──────────────────────────────────
  const payments = await db.select().from(schema.payment).where(
    and(scoped(schema.payment.organizationId, orgId), gte(schema.payment.fecha, from))
  );

  const paymentsData = {
    grossIncome: payments.reduce((s, p) => s + p.monto, 0),
    count: payments.length,
    avgTicket: payments.length > 0 ? payments.reduce((s, p) => s + p.monto, 0) / payments.length : 0,
    withReceipt: payments.filter((p) => p.comprobanteUrl).length,
    withReceiptRate: payments.length > 0 ? (payments.filter((p) => p.comprobanteUrl).length / payments.length) * 100 : 0,
    byMethod: (() => {
      const map = new Map<string, number>();
      for (const p of payments) map.set(p.metodo, (map.get(p.metodo) ?? 0) + p.monto);
      return Array.from(map.entries()).map(([method, amount]) => ({ name: method, amount })).sort((a, b) => b.amount - a.amount);
    })(),
    byMonth: (() => {
      const map = new Map<string, number>();
      for (const p of payments) {
        const month = new Date(p.fecha).toISOString().slice(0, 7);
        map.set(month, (map.get(month) ?? 0) + p.monto);
      }
      return Array.from(map.entries()).map(([month, amount]) => ({ month, amount })).sort((a, b) => a.month.localeCompare(b.month));
    })(),
  };

  // ─── F. GASTOS ─────────────────────────────────
  const expenses = await db.select().from(schema.expense).where(
    and(scoped(schema.expense.organizationId, orgId), gte(schema.expense.fecha, from))
  );

  const expensesData = {
    total: expenses.reduce((s, e) => s + e.monto, 0),
    expenseVsIncome: paymentsData.grossIncome > 0 ? (expenses.reduce((s, e) => s + e.monto, 0) / paymentsData.grossIncome) * 100 : 0,
    byCategory: (() => {
      const map = new Map<string, number>();
      for (const e of expenses) map.set(e.categoria, (map.get(e.categoria) ?? 0) + e.monto);
      return Array.from(map.entries()).map(([category, amount]) => ({ name: category, amount })).sort((a, b) => b.amount - a.amount);
    })(),
    bySupplier: (() => {
      const map = new Map<string, number>();
      for (const e of expenses) if (e.proveedor) map.set(e.proveedor, (map.get(e.proveedor) ?? 0) + e.monto);
      return Array.from(map.entries()).map(([supplier, amount]) => ({ name: supplier, amount })).sort((a, b) => b.amount - a.amount).slice(0, 10);
    })(),
    byMonth: (() => {
      const map = new Map<string, number>();
      for (const e of expenses) {
        const month = new Date(e.fecha).toISOString().slice(0, 7);
        map.set(month, (map.get(month) ?? 0) + e.monto);
      }
      return Array.from(map.entries()).map(([month, amount]) => ({ month, amount })).sort((a, b) => a.month.localeCompare(b.month));
    })(),
  };

  // ─── G. RENTABILIDAD ────────────────────────────
  const profitability = {
    netIncome: paymentsData.grossIncome - expensesData.total,
    margin: paymentsData.grossIncome > 0 ? ((paymentsData.grossIncome - expensesData.total) / paymentsData.grossIncome) * 100 : 0,
    incomeVsExpenses: (() => {
      const months = new Set([...paymentsData.byMonth.map((m) => m.month), ...expensesData.byMonth.map((m) => m.month)]);
      return Array.from(months).sort().map((month) => ({
        month,
        income: paymentsData.byMonth.find((m) => m.month === month)?.amount ?? 0,
        expense: expensesData.byMonth.find((m) => m.month === month)?.amount ?? 0,
      }));
    })(),
    weeklyCashFlow: (() => {
      const weeks = new Map<string, { income: number; expense: number }>();
      for (const p of payments) {
        const week = getWeekKey(new Date(p.fecha));
        const entry = weeks.get(week) ?? { income: 0, expense: 0 };
        entry.income += p.monto;
        weeks.set(week, entry);
      }
      for (const e of expenses) {
        const week = getWeekKey(new Date(e.fecha));
        const entry = weeks.get(week) ?? { income: 0, expense: 0 };
        entry.expense += e.monto;
        weeks.set(week, entry);
      }
      return Array.from(weeks.entries()).map(([week, data]) => ({ week, ...data, net: data.income - data.expense })).sort((a, b) => a.week.localeCompare(b.week)).slice(-12);
    })(),
  };

  // ─── H. BANDEJA ────────────────────────────────
  const conversations = await db.select().from(schema.conversation).where(
    scoped(schema.conversation.organizationId, orgId)
  );

  const inbox = {
    active: conversations.filter((c) => c.lastMessageAt && (now.getTime() - new Date(c.lastMessageAt).getTime()) < 7 * 86400000).length,
    byChannel: (() => {
      const map = new Map<string, number>();
      for (const c of conversations) map.set(c.channel ?? "whatsapp", (map.get(c.channel ?? "whatsapp") ?? 0) + 1);
      return Array.from(map.entries()).map(([channel, count]) => ({ name: channel, count }));
    })(),
  };

  // ─── I. CONTACTOS ──────────────────────────────
  const contacts = await db.select().from(schema.contact).where(
    scoped(schema.contact.organizationId, orgId)
  );

  const contactsWithProject = new Set(
    allProjects.filter((p) => p.contactId && p.estado !== "cerrado").map((p) => p.contactId)
  );

  const contactsData = {
    total: contacts.length,
    active: contactsWithProject.size,
    newThisPeriod: contacts.filter((c) => new Date(c.createdAt) >= from).length,
    retentionRate: contacts.length > 0 ? (contactsWithProject.size / contacts.length) * 100 : 0,
    bySource: (() => {
      const map = new Map<string, number>();
      for (const c of contacts) map.set(c.source ?? "directo", (map.get(c.source ?? "directo") ?? 0) + 1);
      return Array.from(map.entries()).map(([source, count]) => ({ name: source, count })).sort((a, b) => b.count - a.count);
    })(),
  };

  return Response.json({
    period: periodLabel,
    projects,
    tasks,
    quotes,
    receivables,
    payments: paymentsData,
    expenses: expensesData,
    profitability,
    inbox,
    contacts: contactsData,
  });
});

function getWeekKey(d: Date): string {
  const start = new Date(d);
  start.setDate(start.getDate() - start.getDay());
  return start.toISOString().slice(0, 10);
}
