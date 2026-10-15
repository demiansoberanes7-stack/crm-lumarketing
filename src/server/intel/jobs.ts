import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { listActiveTerms } from "@/server/intel/terms";
import { runGtIngest } from "@/server/intel/service";
import { runGeoIngest } from "@/server/intel/geo";
import { markGtSynced } from "@/server/intel/credentials";

/**
 * Jobs asíncronos de las ingestas INTEL.
 *
 * Las ingestas pesadas (15 nichos con ~60 llamadas externas; 32 estados DENUE)
 * corrían dentro de la petición HTTP y podían rebasar timeouts y duplicarse
 * entre clics. Aquí:
 *
 *  - El POST crea un job `running` y responde 202 con su id.
 *  - El índice único parcial `intel_job_active_uq` impide DOS jobs activos
 *    por (org, kind, término): el segundo clic recibe `null` ⇒ 409.
 *  - La UI sondea `GET /api/intel/jobs/[id]` y muestra avance real.
 *  - Un job que quedó `running` tras un reinicio del proceso se libera solo
 *    (se marca `error`) antes de crear el siguiente.
 */

export type IntelJobKind = "gt_all" | "gt_term" | "geo";
export type IntelJob = typeof schema.intelJob.$inferSelect;

/** Un job running más viejo que esto se considera huérfano (proceso muerto). */
const STALE_JOB_MS = 10 * 60 * 1000;

export function serializeIntelJob(job: IntelJob) {
  return {
    id: job.id,
    kind: job.kind,
    termId: job.termId,
    status: job.status as "running" | "done" | "error",
    total: job.total,
    completed: job.completed,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export type IntelJobView = ReturnType<typeof serializeIntelJob>;

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === "23505") return true;
  const cause = (err as { cause?: unknown }).cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { code?: unknown }).code === "23505"
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Crea el job. Devuelve `null` si YA hay uno igual en curso (candado).
 * Antes de insertar libera los huérfanos para no bloquear para siempre.
 */
export async function createIntelJob(input: {
  organizationId: string;
  kind: IntelJobKind;
  termId?: string | null;
  geo?: string | null;
}): Promise<IntelJob | null> {
  const db = getDb();
  const staleBefore = new Date(Date.now() - STALE_JOB_MS);
  await db
    .update(schema.intelJob)
    .set({
      status: "error",
      error: "Job interrumpido (el proceso reinició a media ingesta).",
      finishedAt: new Date(),
    })
    .where(
      scoped(
        schema.intelJob.organizationId,
        input.organizationId,
        eq(schema.intelJob.status, "running"),
        eq(schema.intelJob.kind, input.kind),
        sql`${schema.intelJob.createdAt} < ${staleBefore}`
      )
    );

  try {
    const rows = await db
      .insert(schema.intelJob)
      .values({
        id: newId("intelJob"),
        organizationId: input.organizationId,
        kind: input.kind,
        termId: input.termId ?? null,
        geo: input.geo ?? null,
      })
      .returning();
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function getIntelJob(
  organizationId: string,
  jobId: string
): Promise<IntelJob | null> {
  const rows = await getDb()
    .select()
    .from(schema.intelJob)
    .where(
      scoped(
        schema.intelJob.organizationId,
        organizationId,
        eq(schema.intelJob.id, jobId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function markIntelJobProgress(
  jobId: string,
  completed: number,
  total: number
): Promise<void> {
  await getDb()
    .update(schema.intelJob)
    .set({ completed, total })
    .where(and(eq(schema.intelJob.id, jobId), eq(schema.intelJob.status, "running")));
}

export async function finishIntelJob(
  jobId: string,
  result: Record<string, unknown>
): Promise<void> {
  await getDb()
    .update(schema.intelJob)
    .set({ status: "done", result, finishedAt: new Date() })
    .where(and(eq(schema.intelJob.id, jobId), eq(schema.intelJob.status, "running")));
}

export async function failIntelJob(jobId: string, error: string): Promise<void> {
  await getDb()
    .update(schema.intelJob)
    .set({ status: "error", error, finishedAt: new Date() })
    .where(and(eq(schema.intelJob.id, jobId), eq(schema.intelJob.status, "running")));
}

/* ── Runners (se ejecutan fuera de la petición, vía after()) ─────────────── */

/** Ingesta GT de TODOS los nichos activos, con progreso por nicho. */
export async function runGtAllJob(input: {
  jobId: string;
  organizationId: string;
}): Promise<void> {
  try {
    const terms = await listActiveTerms(input.organizationId);
    await markIntelJobProgress(input.jobId, 0, terms.length);
    let gtIngested = 0;
    let gtFailed = 0;
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i]!;
      const gt = await runGtIngest(
        input.organizationId,
        term.id,
        term.geo || "MX"
      ).catch(() => ({ ok: false }));
      if (gt.ok) gtIngested += 1;
      else gtFailed += 1;
      await markIntelJobProgress(input.jobId, i + 1, terms.length);
    }
    if (gtIngested > 0) await markGtSynced(input.organizationId);
    await finishIntelJob(input.jobId, {
      ok: gtIngested > 0,
      gtIngested,
      gtFailed,
      total: terms.length,
      source: "google_trends",
    });
  } catch (err) {
    await failIntelJob(input.jobId, errorMessage(err));
  }
}

/** Ingesta GT de UN término. */
export async function runGtTermJob(input: {
  jobId: string;
  organizationId: string;
  termId: string;
  geo: string;
}): Promise<void> {
  try {
    await markIntelJobProgress(input.jobId, 0, 1);
    const result = await runGtIngest(
      input.organizationId,
      input.termId,
      input.geo
    );
    if (!result.ok) {
      await failIntelJob(
        input.jobId,
        result.reason ?? "Google Trends no devolvió datos."
      );
      return;
    }
    await markIntelJobProgress(input.jobId, 1, 1);
    await finishIntelJob(input.jobId, result as unknown as Record<string, unknown>);
  } catch (err) {
    await failIntelJob(input.jobId, errorMessage(err));
  }
}

/** Mapa DENUE (32 estados) con progreso por estado. */
export async function runGeoJob(input: {
  jobId: string;
  organizationId: string;
  termId: string;
}): Promise<void> {
  try {
    const result = await runGeoIngest(
      input.organizationId,
      input.termId,
      async (done, total) => {
        await markIntelJobProgress(input.jobId, done, total);
      }
    );
    if (!result.ok) {
      const message =
        result.reason === "missing_denue_token"
          ? "Configura el token DENUE en Conexiones → Inteligencia"
          : result.reason === "denue_failed"
            ? "DENUE no respondió (puede ser rate limit de INEGI). Intenta de nuevo en unos minutos."
            : "Nicho no encontrado";
      await failIntelJob(input.jobId, message);
      return;
    }
    await finishIntelJob(input.jobId, result as unknown as Record<string, unknown>);
  } catch (err) {
    await failIntelJob(input.jobId, errorMessage(err));
  }
}
