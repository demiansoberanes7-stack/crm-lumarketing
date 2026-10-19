import { after } from "next/server";
import { apiError, withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { createIntelJob, runTrendingJob, serializeIntelJob } from "@/server/intel/jobs";
import { getTrending } from "@/server/intel/trending";

export const dynamic = "force-dynamic";

/**
 * «Tendencias actuales»: qué se busca ahora mismo en el país.
 *
 * GET  — lee la BD (nunca sale a la red): la página abre rápido y no gasta
 *        cuota. Filtros por query: `geo`, `hours` (4|24|48|168), `category`,
 *        `type`, `q`, `sort` (relevance|volume|increase|recent).
 * POST — ingiere la ventana pedida. Responde 202 con el job; el avance se sigue
 *        en `GET /api/intel/jobs/[id]`.
 *
 * No pide `gtEnabled` ni credenciales: el respaldo es el feed público de
 * Google, que no necesita llave. Cuando hay clave SerpApi el orquestador la
 * usa primero y la fila declara de dónde salió.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const url = new URL(req.url);
  const view = await getTrending(session.organizationId, {
    geo: url.searchParams.get("geo"),
    hours: Number(url.searchParams.get("hours")),
    category: url.searchParams.get("category"),
    type: url.searchParams.get("type"),
    q: url.searchParams.get("q"),
    sort: url.searchParams.get("sort"),
  });
  return Response.json(view);
});

export const POST = withAuth(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const url = new URL(req.url);
  const hours = Number(url.searchParams.get("hours"));
  const geo = (url.searchParams.get("geo") ?? "MX").slice(0, 2).toUpperCase() || "MX";

  const job = await createIntelJob({
    organizationId: session.organizationId,
    kind: "trending",
    geo,
  });
  if (!job) {
    return apiError(
      409,
      "job_running",
      "Ya hay una ingesta de tendencias en curso. Espera a que termine."
    );
  }

  after(() =>
    runTrendingJob({
      jobId: job.id,
      organizationId: session.organizationId,
      geo,
      hours: Number.isFinite(hours) ? hours : 24,
    })
  );

  return Response.json({ job: serializeIntelJob(job) }, { status: 202 });
});
