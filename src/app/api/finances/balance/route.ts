import { withAuth, apiError } from "@/lib/api";
import { reportPeriod, financialReport } from "@/server/finances/report";
import { reportPdf, pdfResponse, money } from "@/server/documents/pdf";
export const dynamic = "force-dynamic";
export const GET = withAuth(async (session, req: Request) => {
  const search = new URL(req.url).searchParams;
  let period;
  try { period = reportPeriod(search); } catch (e) { return apiError(422, "invalid_period", (e as Error).message); }
  const report = await financialReport(session.organizationId, period);
  if (search.get("format") !== "pdf") return Response.json(report);
  const from = period.from.toISOString().slice(0, 10); const to = period.to.toISOString().slice(0, 10);
  const pdf = await reportPdf("Balance de ingresos y egresos", [
    `Periodo: ${from} al ${to} (UTC)`,
    `Ingresos: ${money(report.balance.ingresos)}`, `Egresos: ${money(report.balance.egresos)}`, `Resultado: ${money(report.balance.balance)}`,
    "", "INGRESOS", ...report.pagosRecientes.map((p) => `${p.fecha.toISOString().slice(0, 10)} | ${money(p.monto)} | ${p.metodo} | ${p.referencia ?? ""} | ${p.notas ?? ""}`),
    "", "GASTOS", ...report.gastosRecientes.map((p) => `${p.fecha.toISOString().slice(0, 10)} | ${money(p.monto)} | ${p.descripcion} | ${p.categoria} | ${p.metodo}`),
    "", "CUENTAS POR COBRAR (saldo actual a la fecha de emisión)", ...report.cuentasPorCobrar.map((c) => `${c.concept} | Total: ${money(c.totalAmount)} | Pagado: ${money(c.paidAmount)} | Pendiente: ${money(c.totalAmount - c.paidAmount)}`),
  ]);
  return pdfResponse(pdf, `Balance-${from}-${to}.pdf`, search.get("download") === "1");
});
