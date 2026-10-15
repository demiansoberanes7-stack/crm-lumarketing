/**
 * Sondeo de jobs de ingesta INTEL desde el cliente. La respuesta 202 del POST
 * trae el `jobId`; aquí se sigue hasta `done`/`error` con avance (completed/total).
 */

export type IntelJobView = {
  id: string;
  kind: string;
  termId: string | null;
  status: "running" | "done" | "error";
  total: number;
  completed: number;
  result: unknown;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export async function pollIntelJob(
  jobId: string,
  onTick?: (job: IntelJobView) => void,
  opts?: { intervalMs?: number; timeoutMs?: number }
): Promise<IntelJobView | null> {
  const interval = opts?.intervalMs ?? 1500;
  const deadline = Date.now() + (opts?.timeoutMs ?? 8 * 60_000);
  while (Date.now() < deadline) {
    const res = await fetch(`/api/intel/jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    }).catch(() => null);
    if (res?.ok) {
      const data = (await res.json().catch(() => null)) as { job?: IntelJobView } | null;
      const job = data?.job;
      if (job) {
        onTick?.(job);
        if (job.status !== "running") return job;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return null;
}
