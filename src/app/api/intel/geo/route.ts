import { after } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { getIntelCredentials } from "@/server/intel/credentials";
import { createIntelJob, runGeoJob, serializeIntelJob } from "@/server/intel/jobs";
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

/**
 * Captura: 32 consultas DENUE (una por estado) para el nicho indicado.
 * Responde 202 con `jobId`; el avance (n/32) se sigue en
 * `GET /api/intel/jobs/[id]`. Un segundo POST del mismo nicho recibe 409
 * mientras haya uno en curso: no se duplican las 32 consultas.
 */
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

  const creds = await getIntelCredentials(session.organizationId);
  if (!creds?.denueToken) {
    return Response.json(
      {
        error: {
          code: "missing_denue_token",
          message: "Configura el token DENUE en Conexiones → Inteligencia",
        },
      },
      { status: 409 }
    );
  }

  const job = await createIntelJob({
    organizationId: session.organizationId,
    kind: "geo",
    termId: parsed.data.termId,
  });
  if (!job) {
    return Response.json(
      {
        error: {
          code: "job_running",
          message: "Ya hay un cálculo del mapa en curso para este nicho. Espera a que termine.",
        },
      },
      { status: 409 }
    );
  }

  after(() =>
    runGeoJob({
      jobId: job.id,
      organizationId: session.organizationId,
      termId: parsed.data.termId,
    })
  );

  return Response.json({ job: serializeIntelJob(job) }, { status: 202 });
});
