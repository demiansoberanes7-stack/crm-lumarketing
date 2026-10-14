import { z } from "zod";
import { withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { getGeoReport } from "@/server/intel/geo";

export const dynamic = "force-dynamic";

/** Reporte geográfico (competencia DENUE por estado) del último día capturado. */
export const GET = withAuth(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const url = new URL(req.url);
  const termId = url.searchParams.get("termId") ?? "";
  if (!termId) {
    return Response.json(
      { error: { code: "missing_term", message: "Falta el nicho (termId)" } },
      { status: 422 }
    );
  }
  const report = await getGeoReport(session.organizationId, termId);
  return Response.json(report);
});

const ingestSchema = z.object({ termId: z.string().min(1).max(255) });

/** Captura: 32 consultas DENUE (una por estado) para el nicho indicado. */
export const POST = withAuth(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const body = await req.json().catch(() => null);
  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "invalid_body", message: "Se espera { termId }" } },
      { status: 422 }
    );
  }
  const { runGeoIngest } = await import("@/server/intel/geo");
  const result = await runGeoIngest(session.organizationId, parsed.data.termId);
  if (!result.ok) {
    const status = result.reason === "missing_denue_token" ? 409 : result.reason === "denue_failed" ? 502 : 404;
    const message =
      result.reason === "missing_denue_token"
        ? "Configura el token DENUE en Conexiones → Inteligencia"
        : result.reason === "denue_failed"
          ? "DENUE no respondió (puede ser rate limit de INEGI). Intenta de nuevo en unos minutos."
          : "Nicho no encontrado";
    return Response.json({ error: { code: result.reason, message } }, { status });
  }
  return Response.json(result);
});
