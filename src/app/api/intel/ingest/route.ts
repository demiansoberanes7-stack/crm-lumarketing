import { apiError, withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { runGtIngest } from "@/server/intel/service";
import { getIntelCredentials, markGtSynced } from "@/server/intel/credentials";
import { listActiveTerms } from "@/server/intel/terms";

export const dynamic = "force-dynamic";

/**
 * Dispara la ingesta del día SOLO con Google Trends (fuente externa).
 * No toca YouTube Data API ni datos internos del CRM.
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

  const terms = await listActiveTerms(session.organizationId);
  let gtIngested = 0;
  let gtFailed = 0;
  for (const term of terms) {
    const gt = await runGtIngest(session.organizationId, term.id, term.geo || "MX");
    if (gt.ok) gtIngested += 1;
    else gtFailed += 1;
  }
  if (gtIngested > 0) await markGtSynced(session.organizationId);

  return Response.json({
    ok: gtIngested > 0,
    gtIngested,
    gtFailed,
    total: terms.length,
    source: "google_trends",
  });
});
