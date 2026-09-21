import type { schema } from "@/lib/db";

export type DashboardInput = {
  projects: (typeof schema.project.$inferSelect)[];
  stages: (typeof schema.projectStage.$inferSelect)[];
  stageEvents: (typeof schema.projectStageEvent.$inferSelect)[];
  tasks: (typeof schema.projectTask.$inferSelect)[];
  quotes: (typeof schema.quote.$inferSelect)[];
  charges: (typeof schema.charge.$inferSelect)[];
  payments: (typeof schema.payment.$inferSelect)[];
  expenses: (typeof schema.expense.$inferSelect)[];
  conversations: (typeof schema.conversation.$inferSelect)[];
  contacts: (typeof schema.contact.$inferSelect)[];
  members: { id: string; name: string }[];
};
const DAY = 86400000;
export function dashboardRange(period: string, now = new Date()) {
  const days = ({ "7d": 7, "30d": 30, "90d": 90, "1y": 365 } as Record<string, number>)[period] ?? 30;
  // Calendar days in UTC, including today up to the captured instant.
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * DAY);
  return { from, to: now, label: `Últimos ${days} días` };
}
export function weekKey(d: Date) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  return start.toISOString().slice(0, 10);
}
const percent = (n: number, d: number): number | null => d > 0 ? n / d * 100 : null;
const sum = <T>(rows: T[], amount: (row: T) => number) => rows.reduce((total, row) => total + amount(row), 0);
function groups<T>(rows: T[], key: (row: T) => string, value: (row: T) => number = () => 1) {
  const result = new Map<string, number>();
  for (const row of rows) result.set(key(row), (result.get(key(row)) ?? 0) + value(row));
  return [...result].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}
const counts = <T>(rows: T[], key: (row: T) => string) => groups(rows, key).map(({ name, amount }) => ({ name, count: amount }));

export function buildDashboard(input: DashboardInput, period: string, now = new Date()) {
  const { from, to, label } = dashboardRange(period, now);
  const within = (date: Date) => date >= from && date <= to;
  const today = to.toISOString().slice(0, 10);
  const dueBeforeToday = (date: Date | null) => date !== null && date.toISOString().slice(0, 10) < today;
  const allProjects = input.projects.filter((p) => p.createdAt <= to);
  const currentProjects = allProjects.filter((p) => !p.archivedAt);
  const activeProjects = currentProjects.filter((p) => p.estado === "activo");
  const projectIds = new Set(currentProjects.map((p) => p.id));
  const completed = currentProjects.filter((p) => p.estado === "cerrado").length;
  const names = new Map(input.members.map((m) => [m.id, m.name]));
  const stages = new Map(input.stages.map((s) => [s.id, s.name]));
  const durations = new Map<string, { total: number; count: number }>();
  const lastEvent = new Map<string, { at: Date; stage: string | null }>();
  for (const event of [...input.stageEvents].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const project = allProjects.find((p) => p.id === event.projectId);
    if (!project || event.createdAt > to) continue;
    const previous = lastEvent.get(event.projectId);
    const enteredAt = previous?.at ?? project.createdAt;
    const stageId = event.fromStageId ?? previous?.stage;
    // A completed stay belongs to the stage LEFT, never the stage entered.
    if (within(event.createdAt) && stageId && event.fromStageId !== event.toStageId && event.createdAt >= enteredAt) {
      const name = stages.get(stageId) ?? event.fromStageName ?? "Etapa eliminada";
      const value = durations.get(name) ?? { total: 0, count: 0 };
      value.total += (event.createdAt.getTime() - enteredAt.getTime()) / DAY;
      value.count++;
      durations.set(name, value);
    }
    if (!previous || event.fromStageId !== event.toStageId) lastEvent.set(event.projectId, { at: event.createdAt, stage: event.toStageId });
  }
  const projects = {
    total: currentProjects.length, active: activeProjects.length, archived: allProjects.length - currentProjects.length,
    completed, completionRate: percent(completed, currentProjects.length) ?? 0,
    avgAdvance: activeProjects.length ? sum(activeProjects, (p) => p.avance) / activeProjects.length : 0,
    highRisk: activeProjects.filter((p) => p.riesgo === "alto").length,
    projectsByStage: counts(activeProjects, (p) => stages.get(p.stageId ?? "") ?? "Sin etapa"),
    projectsByAssignee: counts(activeProjects, (p) => names.get(p.assignedUserId ?? "") ?? "Sin asignar"),
    avgTimeByStage: [...durations].map(([stage, value]) => ({ stage, avgDays: value.total / value.count })),
  };
  const allTasks = input.tasks.filter((t) => projectIds.has(t.projectId) && t.createdAt <= to);
  const openTasks = allTasks.filter((t) => t.estado !== "terminado");
  const weekStart = new Date(`${weekKey(to)}T00:00:00Z`);
  const soonEnd = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) + 7 * DAY);
  const tasks = {
    total: allTasks.length, completed: allTasks.length - openTasks.length,
    pending: openTasks.filter((t) => t.estado === "pendiente").length,
    notStarted: openTasks.filter((t) => t.estado === "no_empezado").length,
    completedThisWeek: allTasks.filter((t) => t.estado === "terminado" && t.updatedAt >= weekStart && t.updatedAt <= to).length,
    pendingDueSoon: openTasks.filter((t) => t.dueDate && !dueBeforeToday(t.dueDate) && t.dueDate < soonEnd).length,
    overdue: openTasks.filter((t) => dueBeforeToday(t.dueDate)).length,
    unassigned: openTasks.filter((t) => !t.assigneeId).length,
    byPriority: counts(openTasks, (t) => ({ alta: "Alta", media: "Media", baja: "Baja" } as Record<string, string>)[t.priority ?? ""] ?? "Sin prioridad"),
  };
  const quoteById = new Map(input.quotes.map((q) => [q.id, q]));
  const mxnQuote = (quoteId: string | null) => !quoteId || !quoteById.has(quoteId) || quoteById.get(quoteId)!.currency === "MXN";
  const cohort = input.quotes.filter((q) => within(q.createdAt) && !q.archivedAt);
  const periodQuotes = cohort.filter((q) => q.currency === "MXN");
  const submitted = (q: typeof schema.quote.$inferSelect) => ["sent", "accepted", "rejected", "expired"].includes(q.status);
  const sent = periodQuotes.filter(submitted);
  const approved = periodQuotes.filter((q) => q.status === "accepted");
  const months: string[] = [];
  for (const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); date <= to; date.setUTCMonth(date.getUTCMonth() + 1)) months.push(date.toISOString().slice(0, 7));
  const month = (date: Date) => date.toISOString().slice(0, 7);
  const quotes = {
    total: periodQuotes.length, sent: sent.length, approved: approved.length, approvalRate: percent(approved.length, sent.length),
    avgTicket: approved.length ? sum(approved, (q) => q.total) / approved.length : 0,
    pipelineValue: sum(periodQuotes.filter((q) => ["draft", "sent"].includes(q.status) && (!q.validUntil || !dueBeforeToday(q.validUntil))), (q) => q.total),
    avgDiscount: approved.length ? sum(approved, (q) => q.discountAmount) / approved.length : 0,
    byMonth: months.map((m) => ({ month: m, sent: sent.filter((q) => month(q.createdAt) === m).length, approved: approved.filter((q) => month(q.createdAt) === m).length })),
    byChannel: counts(sent, (q) => q.sendChannel ?? "Sin canal"), excludedCurrency: cohort.length - periodQuotes.length,
  };
  const futurePaid = new Map<string, number>();
  for (const p of input.payments) if (p.chargeId && p.fecha > to) futurePaid.set(p.chargeId, (futurePaid.get(p.chargeId) ?? 0) + p.monto);
  const balance = (c: typeof schema.charge.$inferSelect) => Math.max(0, c.totalAmount - c.paidAmount + (futurePaid.get(c.id) ?? 0));
  const charges = input.charges.filter((c) => c.createdAt <= to && mxnQuote(c.quoteId) && balance(c) > 0 && c.status !== "cancelado");
  const overdue = charges.filter((c) => dueBeforeToday(c.dueDate));
  const totalPending = sum(charges, balance), overdueAmount = sum(overdue, balance);
  const buckets: Record<string, number> = { "1-30": 0, "31-60": 0, "61-90": 0, "91+": 0 };
  for (const charge of overdue) {
    const days = Math.round((Date.parse(today) - Date.parse(charge.dueDate!.toISOString().slice(0, 10))) / DAY);
    const bucket = days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "91+";
    buckets[bucket]! += balance(charge);
  }
  const receivables = { totalPending, overdueCount: overdue.length, overdueAmount, overdueRate: percent(overdueAmount, totalPending), aging: Object.entries(buckets).map(([bucket, amount]) => ({ bucket, amount })), topDebtors: [...charges].sort((a, b) => balance(b) - balance(a)).slice(0, 10).map((c) => ({ id: c.id, concept: c.concept, amount: balance(c) })) };
  const chargeById = new Map(input.charges.map((c) => [c.id, c]));
  const payments = input.payments.filter((p) => within(p.fecha) && mxnQuote(chargeById.get(p.chargeId ?? "")?.quoteId ?? null));
  const expenses = input.expenses.filter((e) => within(e.fecha));
  const grossIncome = sum(payments, (p) => p.monto), expenseTotal = sum(expenses, (e) => e.monto);
  const withReceipt = payments.filter((p) => p.comprobanteUrl?.trim()).length;
  const paymentsData = { grossIncome, count: payments.length, avgTicket: payments.length ? grossIncome / payments.length : 0, withReceipt, withReceiptRate: percent(withReceipt, payments.length) ?? 0, byMethod: groups(payments, (p) => p.metodo, (p) => p.monto), byMonth: months.map((m) => ({ month: m, amount: sum(payments.filter((p) => month(p.fecha) === m), (p) => p.monto) })) };
  const expensesData = { total: expenseTotal, expenseVsIncome: percent(expenseTotal, grossIncome), byCategory: groups(expenses, (e) => e.categoria, (e) => e.monto), bySupplier: groups(expenses, (e) => e.proveedor?.trim() || "Sin proveedor", (e) => e.monto).slice(0, 10), byMonth: months.map((m) => ({ month: m, amount: sum(expenses.filter((e) => month(e.fecha) === m), (e) => e.monto) })) };
  const weeks: string[] = [];
  for (let date = new Date(`${weekKey(from)}T00:00:00Z`); date <= to; date = new Date(date.getTime() + 7 * DAY)) weeks.push(weekKey(date));
  const profitability = {
    netIncome: grossIncome - expenseTotal, margin: percent(grossIncome - expenseTotal, grossIncome),
    incomeVsExpenses: months.map((m, i) => ({ month: m, income: paymentsData.byMonth[i]!.amount, expense: expensesData.byMonth[i]!.amount })),
    weeklyCashFlow: weeks.map((week) => { const income = sum(payments.filter((p) => weekKey(p.fecha) === week), (p) => p.monto), expense = sum(expenses.filter((e) => weekKey(e.fecha) === week), (e) => e.monto); return { week, income, expense, net: income - expense }; }),
  };
  const conversations = input.conversations.filter((c) => !c.isTest && c.lastMessageAt && within(c.lastMessageAt));
  const contacts = input.contacts.filter((c) => !c.archivedAt && c.createdAt <= to);
  const contactIds = new Set(contacts.map((c) => c.id));
  const activeContactIds = new Set(activeProjects.filter((p) => p.contactId && contactIds.has(p.contactId)).map((p) => p.contactId));
  return {
    period: label, range: { from: from.toISOString(), to: to.toISOString(), timezone: "UTC" }, currency: "MXN",
    projects, tasks, quotes, receivables, payments: paymentsData, expenses: expensesData, profitability,
    inbox: { active: conversations.length, byChannel: counts(conversations, (c) => c.channel) },
    contacts: { total: contacts.length, active: activeContactIds.size, newThisPeriod: contacts.filter((c) => within(c.createdAt)).length, activityRate: percent(activeContactIds.size, contacts.length), bySource: counts(contacts, (c) => c.source ?? "directo") },
  };
}
export type DashboardData = ReturnType<typeof buildDashboard>;
