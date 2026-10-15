import { after } from "next/server";
import { apiError, withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { getIntelCredentials } from "@/server/intel/credentials";
import { createIntelJob, runGtAllJob, serializeIntelJob } from "@/server/intel/jobs";

export const dynamic = "force-dynamic";

/**
 * Dispara la ingesta del día SOLO con Google Trends (fuente externa).
 * Responde 202 con el `jobId`: el trabajo corre fuera de la petición y la UI
 * sigue su progreso en `GET /api/intel/jobs/[id]`. Si ya hay una ingesta en
 * curso, responde 409 — el candado impide gastar la cuota dos veces.
 * Re-ejecutable: los snapshots GT del día se upsertean (dedupe por día).
 */
export const POST = withAuth(async (session) => {
  if (!intelEnabled()) return intelDisabledResponse();

  const creds = await getIntelCredentials(session.organizationId);
  if (!creds?.gtEnabled) {
    return apiError(
      409,
      "gt_not_enabled",
      "Activa Google Trends en Conexiones → Inteligencia para poder ingectar datos."
    );
  }

  const job = await createIntelJob({
    organizationId: session.organizationId,
    kind: "gt_all",
  });
  if (!job) {
    return apiError(
      409,
      "job_running",
      "Ya hay una ingesta de Google Trends en curso. Espera a que termine."
    );
  }

  after(() =>
    runGtAllJob({ jobId: job.id, organizationId: session.organizationId })
  );

  return Response.json({ job: serializeIntelJob(job) }, { status: 202 });
});
