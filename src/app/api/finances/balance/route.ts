import { withAuth } from "@/lib/api";
import {
  getMonthlyBalance,
  getBalanceByPeriod,
  getAccountsReceivable,
  getRecentPayments,
  getRecentExpenses,
} from "@/server/finances/service";

export const dynamic = "force-dynamic";

/** GET — balance general y KPIs */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  let balance;
  if (fromParam && toParam) {
    balance = await getBalanceByPeriod(
      session.organizationId,
      new Date(fromParam),
      new Date(toParam)
    );
  } else {
    balance = await getMonthlyBalance(session.organizationId);
  }

  const [receivable, payments, expenses] = await Promise.all([
    getAccountsReceivable(session.organizationId),
    getRecentPayments(session.organizationId, 10),
    getRecentExpenses(session.organizationId, 10),
  ]);

  return Response.json({
    balance,
    cuentasPorCobrar: receivable,
    pagosRecientes: payments,
    gastosRecientes: expenses,
  });
});
