import { apiError, withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import {
  IngestNotConfiguredError,
  runGtIngest,
  runIngest,
} from "@/server/intel/service";
import { getIntelCredentials, markGtSynced } from "@/server/intel/credentials";
import { listActiveTerms } from "@/server/intel/terms";
import { YoutubeError } from "@/server/intel/sources/youtube";

export const dynamic = "force-dynamic";

/**
 * Dispara la ingesta del día (feed popular de YouTube contra el catálogo).
 * Si Google Trends está habilitado en BD, también ingiere la serie GT de
 * cada nicho activo (respeta rate limit de 2 s entre consultas).
 * Re-ejecutable: los snapshots y videos del día se upsertean/deduplican.
 */
export const POST = withAuth(async (session) => {
  if (!intelEnabled()) return intelDisabledResponse();
  try {
    const result = await runIngest(session.organizationId);

    // GT best-effort: nunca bloquea la ingesta principal si falla.
    let gtIngested = 0;
    try {
      const creds = await getIntelCredentials(session.organizationId);
      if (creds?.gtEnabled) {
        const terms = await listActiveTerms(session.organizationId);
        for (const term of terms) {
          const gt = await runGtIngest(session.organizationId, term.id, term.geo || "MX");
          if (gt.ok) gtIngested += 1;
        }
        if (gtIngested > 0) await markGtSynced(session.organizationId);
      }
    } catch {
      // degradación elegante: YouTube ya quedó ingerido
    }

    return Response.json({ ...result, gtIngested });
  } catch (err) {
    if (err instanceof IngestNotConfiguredError) {
      return apiError(
        409,
        "intel_not_configured",
        "Configura la API key de YouTube en Conexiones → Inteligencia"
      );
    }
    if (err instanceof YoutubeError) {
      return apiError(422, "intel_source_failed", err.message);
    }
    throw err;
  }
});
