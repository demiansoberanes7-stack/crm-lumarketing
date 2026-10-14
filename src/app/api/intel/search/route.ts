import { withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { searchReport } from "@/server/intel/service";

export const dynamic = "force-dynamic";

/**
 * Estado 2: informe de búsqueda. `q` es el término o idea a evaluar;
 * respuesta rápida + descriptiva + inferencia + competencia (si hay DENUE).
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) {
    return Response.json(
      { error: { code: "missing_query", message: "Falta el parámetro q" } },
      { status: 422 }
    );
  }
  const report = await searchReport(session.organizationId, q);
  return Response.json(report);
});
