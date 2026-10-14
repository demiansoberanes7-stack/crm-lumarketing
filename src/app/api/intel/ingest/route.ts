import { apiError, withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import {
  IngestNotConfiguredError,
  runIngest,
} from "@/server/intel/service";
import { YoutubeError } from "@/server/intel/sources/youtube";

export const dynamic = "force-dynamic";

/**
 * Dispara la ingesta del día (feed popular de YouTube contra el catálogo).
 * Re-ejecutable: los snapshots y videos del día se upsertean/deduplican.
 */
export const POST = withAuth(async (session) => {
  if (!intelEnabled()) return intelDisabledResponse();
  try {
    const result = await runIngest(session.organizationId);
    return Response.json(result);
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
