import { after } from "next/server";
import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { getIntelCredentials } from "@/server/intel/credentials";
import { createIntelJob, runGtTermJob, serializeIntelJob } from "@/server/intel/jobs";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  termId: z.string().min(1),
  geo: z.string().length(2).default("MX"),
});

/**
 * Dispara la ingesta de Google Trends para un término (serie, regiones,
 * relacionados). Re-ejecutable: upsert por día. El control es el checkbox
 * `gtEnabled` de la BD (GT es gratis y sin credenciales, no necesita env var).
 * Responde 202 con `jobId`; si ya hay una ingesta del mismo término en curso,
 * 409. El avance se sigue en `GET /api/intel/jobs/[id]`.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();

  const creds = await getIntelCredentials(session.organizationId);
  if (!creds?.gtEnabled) {
    return apiError(409, "gt_not_enabled", "Activa Google Trends en Conexiones → Inteligencia.");
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "invalid_body", "termId y geo requeridos");
  }

  const job = await createIntelJob({
    organizationId: session.organizationId,
    kind: "gt_term",
    termId: parsed.data.termId,
    geo: parsed.data.geo,
  });
  if (!job) {
    return apiError(
      409,
      "job_running",
      "Ya hay una ingesta en curso para este término. Espera a que termine."
    );
  }

  after(() =>
    runGtTermJob({
      jobId: job.id,
      organizationId: session.organizationId,
      termId: parsed.data.termId,
      geo: parsed.data.geo,
    })
  );

  return Response.json({ job: serializeIntelJob(job) }, { status: 202 });
});
