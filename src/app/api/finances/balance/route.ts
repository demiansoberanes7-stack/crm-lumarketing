import { withAuth, apiError } from "@/lib/api";
import { reportPeriod, financialReport } from "@/server/finances/report";
import { balancePdf } from "@/server/finances/balance-pdf";
import { money } from "@/server/documents/pdf";
export const dynamic = "force-dynamic";
export const GET = withAuth(async (session, req: Request) => {
  const search = new URL(req.url).searchParams;
  let period;
  try { period = reportPeriod(search); } catch (e) { return apiError(422, "invalid_period", (e as Error).message); }
  const report = await financialReport(session.organizationId, period);
  if (search.get("format") !== "pdf") return Response.json(report);
  const pdf = await balancePdf(session.organizationId, period);
  if (!pdf) return apiError(500, "pdf_error", "No se pudo generar el PDF");
  const from = period.from.toISOString().slice(0, 10); const to = period.to.toISOString().slice(0, 10);
  const filename = `Balance-${from}-${to}.pdf`;
  return new Response(Buffer.from(pdf.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${search.get("download") === "1" ? "attachment" : "inline"}; filename="${filename}"`,
    },
  });
});
