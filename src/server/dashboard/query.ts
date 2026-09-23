import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { dashboardRange, type DashboardData } from "./metrics";

// Aggregate before transferring data to Node. No row caps: financial totals must
// remain exact regardless of the number of contacts, events or transactions.
const list = (query: SQL) => sql`coalesce((select jsonb_agg(item) from (${query}) item), '[]'::jsonb)`;

export async function queryDashboard(orgId: string, period: string, now = new Date()): Promise<DashboardData> {
  const range = dashboardRange(period, now);
  const from = sql`${range.from.toISOString()}::timestamp`;
  const to = sql`${now.toISOString()}::timestamp`;
  const today = sql`date_trunc('day', ${to})`;
  const scope = (table: { organizationId: PgColumn }) => scoped(table.organizationId, orgId);

  return getDb().transaction(async (db) => {
    // A stalled/overloaded database produces the existing recoverable API error,
    // instead of monopolizing a pool connection indefinitely.
    await db.execute(sql`set local statement_timeout = '15s'`);
    const [row] = await db.execute<{ data: DashboardData }>(sql`
      with
      p as (
        select id, estado, avance, archived_at, riesgo, stage_id, assigned_user_id, contact_id, created_at
        from project where ${scope(schema.project)} and created_at <= ${to}
      ),
      ps as (select id, name from project_stage where ${scope(schema.projectStage)}),
      members as (
        select "user".id, "user".name from member join "user" on "user".id = member.user_id
        where ${scope(schema.member)}
      ),
      active_p as (select * from p where archived_at is null and estado = 'activo'),
      event_order as (
        select project_stage_event.id, project_id, from_stage_id, to_stage_id, from_stage_name,
          project_stage_event.created_at, p.created_at as project_created_at,
          row_number() over (partition by project_id order by project_stage_event.created_at, project_stage_event.id) as rn
        from project_stage_event join p on p.id = project_stage_event.project_id
        where ${scope(schema.projectStageEvent)} and project_stage_event.created_at <= ${to}
      ),
      stays as (
        select *, lag(created_at) over w as previous_at, lag(to_stage_id) over w as previous_stage
        from event_order where rn = 1 or from_stage_id is distinct from to_stage_id
        window w as (partition by project_id order by created_at, id)
      ),
      t as (
        select estado, updated_at, due_date, assignee_id, priority from project_task
        where ${scope(schema.projectTask)} and created_at <= ${to}
          and project_id in (select id from p where archived_at is null)
      ),
      q_currency as (select id, currency from quote where ${scope(schema.quote)}),
      q_cohort as (
        select currency, status, total, discount_amount, valid_until, created_at, send_channel from quote
        where ${scope(schema.quote)} and archived_at is null and created_at between ${from} and ${to}
      ),
      q as (select * from q_cohort where currency = 'MXN'),
      c as (
        select charge.id, quote_id, total_amount, paid_amount, charge.created_at, status, due_date, concept
        from charge left join q_currency on q_currency.id = charge.quote_id
        where ${scope(schema.charge)} and (q_currency.id is null or q_currency.currency = 'MXN')
      ),
      pay as (
        select charge_id, fecha, monto, metodo, comprobante_url from payment
        where ${scope(schema.payment)} and fecha >= ${from}
      ),
      future_paid as (select charge_id, sum(monto) as amount from pay where fecha > ${to} group by charge_id),
      balances as (
        select c.id, concept, due_date, greatest(0, total_amount - paid_amount + coalesce(future_paid.amount, 0)) as amount
        from c left join future_paid on future_paid.charge_id = c.id
        where created_at <= ${to} and status <> 'cancelado'
      ),
      pending as (select * from balances where amount > 0),
      income as (
        select * from pay where fecha <= ${to} and
          (charge_id is null or charge_id in (select id from c)
            or not exists (select 1 from charge where ${scope(schema.charge)} and charge.id = pay.charge_id))
      ),
      exp as (
        select fecha, monto, categoria, proveedor from expense
        where ${scope(schema.expense)} and fecha between ${from} and ${to}
      ),
      conv as (
        select channel from conversation where ${scope(schema.conversation)}
          and is_test = false and last_message_at between ${from} and ${to}
      ),
      ct as (
        select id, source, created_at from contact where ${scope(schema.contact)}
          and archived_at is null and created_at <= ${to}
      ),
      months as (select to_char(m, 'YYYY-MM') as month from generate_series(date_trunc('month', ${from}), ${to}, interval '1 month') m),
      weeks as (select to_char(w, 'YYYY-MM-DD') as week from generate_series(date_trunc('week', ${from}), ${to}, interval '1 week') w),
      income_month as (select to_char(fecha, 'YYYY-MM') as month, sum(monto) as amount from income group by 1),
      expense_month as (select to_char(fecha, 'YYYY-MM') as month, sum(monto) as amount from exp group by 1),
      income_week as (select to_char(date_trunc('week', fecha), 'YYYY-MM-DD') as week, sum(monto) as amount from income group by 1),
      expense_week as (select to_char(date_trunc('week', fecha), 'YYYY-MM-DD') as week, sum(monto) as amount from exp group by 1),
      cash as (select coalesce((select sum(monto) from income), 0) as gross, coalesce((select sum(monto) from exp), 0) as spent)
      select jsonb_build_object(
        'period', ${range.label}::text,
        'range', jsonb_build_object('from', ${range.from.toISOString()}::text, 'to', ${now.toISOString()}::text, 'timezone', 'UTC'),
        'currency', 'MXN',
        'projects', (select jsonb_build_object(
          'total', count(*) filter (where archived_at is null),
          'active', count(*) filter (where archived_at is null and estado = 'activo'),
          'archived', count(*) filter (where archived_at is not null),
          'completed', count(*) filter (where archived_at is null and estado = 'cerrado'),
          'completionRate', coalesce(100.0 * count(*) filter (where archived_at is null and estado = 'cerrado') / nullif(count(*) filter (where archived_at is null), 0), 0),
          'avgAdvance', coalesce(avg(avance) filter (where archived_at is null and estado = 'activo'), 0),
          'highRisk', count(*) filter (where archived_at is null and estado = 'activo' and riesgo = 'alto'),
          'projectsByStage', ${list(sql`select coalesce(ps.name, 'Sin etapa') as name, count(*) as count from active_p left join ps on ps.id = active_p.stage_id group by 1 order by count desc, name`)},
          'projectsByAssignee', ${list(sql`select coalesce(members.name, 'Sin asignar') as name, count(*) as count from active_p left join members on members.id = active_p.assigned_user_id group by 1 order by count desc, name`)},
          'avgTimeByStage', ${list(sql`
            select coalesce(ps.name, stays.from_stage_name, 'Etapa eliminada') as stage,
              avg(extract(epoch from (stays.created_at - coalesce(previous_at, project_created_at))) / 86400) as "avgDays"
            from stays left join ps on ps.id = coalesce(from_stage_id, previous_stage)
            where stays.created_at between ${from} and ${to}
              and from_stage_id is distinct from to_stage_id and coalesce(from_stage_id, previous_stage) is not null
              and stays.created_at >= coalesce(previous_at, project_created_at)
            group by 1 order by stage`)}
        ) from p),
        'tasks', (select jsonb_build_object(
          'total', count(*), 'completed', count(*) filter (where estado = 'terminado'),
          'pending', count(*) filter (where estado = 'pendiente'), 'notStarted', count(*) filter (where estado = 'no_empezado'),
          'completedThisWeek', count(*) filter (where estado = 'terminado' and updated_at between date_trunc('week', ${to}) and ${to}),
          'pendingDueSoon', count(*) filter (where estado <> 'terminado' and due_date >= ${today} and due_date < ${today} + interval '7 days'),
          'overdue', count(*) filter (where estado <> 'terminado' and due_date < ${today}),
          'unassigned', count(*) filter (where estado <> 'terminado' and assignee_id is null),
          'byPriority', ${list(sql`select case priority when 'alta' then 'Alta' when 'media' then 'Media' when 'baja' then 'Baja' else 'Sin prioridad' end as name, count(*) as count from t where estado <> 'terminado' group by 1 order by count desc, name`)}
        ) from t),
        'quotes', (select jsonb_build_object(
          'total', count(*), 'sent', count(*) filter (where status in ('sent', 'accepted', 'rejected', 'expired')),
          'approved', count(*) filter (where status = 'accepted'),
          'approvalRate', 100.0 * count(*) filter (where status = 'accepted') / nullif(count(*) filter (where status in ('sent', 'accepted', 'rejected', 'expired')), 0),
          'avgTicket', coalesce(avg(total) filter (where status = 'accepted'), 0),
          'pipelineValue', coalesce(sum(total) filter (where status in ('draft', 'sent') and (valid_until is null or valid_until >= ${today})), 0),
          'avgDiscount', coalesce(avg(discount_amount) filter (where status = 'accepted'), 0),
          'excludedCurrency', (select count(*) from q_cohort where currency <> 'MXN'),
          'byMonth', ${list(sql`select months.month, count(q.created_at) filter (where status in ('sent', 'accepted', 'rejected', 'expired')) as sent, count(q.created_at) filter (where status = 'accepted') as approved from months left join q on to_char(q.created_at, 'YYYY-MM') = months.month group by 1 order by month`)},
          'byChannel', ${list(sql`select coalesce(send_channel, 'Sin canal') as name, count(*) as count from q where status in ('sent', 'accepted', 'rejected', 'expired') group by 1 order by count desc, name`)}
        ) from q),
        'receivables', (select jsonb_build_object(
          'totalPending', coalesce(sum(amount), 0), 'overdueCount', count(*) filter (where due_date < ${today}),
          'overdueAmount', coalesce(sum(amount) filter (where due_date < ${today}), 0),
          'overdueRate', 100.0 * coalesce(sum(amount) filter (where due_date < ${today}), 0) / nullif(sum(amount), 0),
          'aging', ${list(sql`
            select bucket, coalesce(sum(amount), 0) as amount
            from (values ('1-30', 1, 30), ('31-60', 31, 60), ('61-90', 61, 90), ('91+', 91, 2147483647)) b(bucket, lo, hi)
            left join pending on (${today}::date - due_date::date) between lo and hi group by bucket, lo order by lo`)},
          'topDebtors', ${list(sql`select id, concept, amount from pending order by amount desc, id limit 10`)}
        ) from pending),
        'payments', (select jsonb_build_object(
          'grossIncome', coalesce(sum(monto), 0), 'count', count(*), 'avgTicket', coalesce(avg(monto), 0),
          'withReceipt', count(*) filter (where length(trim(comprobante_url)) > 0),
          'withReceiptRate', coalesce(100.0 * count(*) filter (where length(trim(comprobante_url)) > 0) / nullif(count(*), 0), 0),
          'byMethod', ${list(sql`select metodo as name, sum(monto) as amount from income group by 1 order by amount desc, name`)},
          'byMonth', ${list(sql`select months.month, coalesce(amount, 0) as amount from months left join income_month using (month) order by month`)}
        ) from income),
        'expenses', jsonb_build_object(
          'total', cash.spent, 'expenseVsIncome', 100.0 * cash.spent / nullif(cash.gross, 0),
          'byCategory', ${list(sql`select categoria as name, sum(monto) as amount from exp group by 1 order by amount desc, name`)},
          'bySupplier', ${list(sql`select coalesce(nullif(trim(proveedor), ''), 'Sin proveedor') as name, sum(monto) as amount from exp group by 1 order by amount desc, name limit 10`)},
          'byMonth', ${list(sql`select months.month, coalesce(amount, 0) as amount from months left join expense_month using (month) order by month`)}
        ),
        'profitability', jsonb_build_object(
          'netIncome', cash.gross - cash.spent, 'margin', 100.0 * (cash.gross - cash.spent) / nullif(cash.gross, 0),
          'incomeVsExpenses', ${list(sql`select months.month, coalesce(income_month.amount, 0) as income, coalesce(expense_month.amount, 0) as expense from months left join income_month using (month) left join expense_month using (month) order by month`)},
          'weeklyCashFlow', ${list(sql`select weeks.week, coalesce(income_week.amount, 0) as income, coalesce(expense_week.amount, 0) as expense, coalesce(income_week.amount, 0) - coalesce(expense_week.amount, 0) as net from weeks left join income_week using (week) left join expense_week using (week) order by week`)}
        ),
        'inbox', jsonb_build_object('active', (select count(*) from conv), 'byChannel', ${list(sql`select channel as name, count(*) as count from conv group by 1 order by count desc, name`)}),
        'contacts', (select jsonb_build_object(
          'total', count(*), 'active', count(*) filter (where id in (select contact_id from active_p)),
          'newThisPeriod', count(*) filter (where created_at >= ${from}),
          'activityRate', 100.0 * count(*) filter (where id in (select contact_id from active_p)) / nullif(count(*), 0),
          'bySource', ${list(sql`select coalesce(source, 'directo') as name, count(*) as count from ct group by 1 order by count desc, name`)}
        ) from ct)
      ) as data from cash
    `);
    if (!row) throw new Error("Dashboard aggregation returned no result");
    return row.data;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
