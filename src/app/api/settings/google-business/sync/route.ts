import { apiError, withAuth } from "@/lib/api";
import {
  googleBusinessDisabledResponse,
  googleBusinessEnabled,
} from "@/server/google-business/flag";
import { getGoogleBusinessCredentials } from "@/server/google-business/credentials";
import { syncOrganization } from "@/server/google-business/sync";

export const dynamic = "force-dynamic";

/** Sync manual de reseñas: el botón de la pestaña de Configuración. */
export const POST = withAuth(async (session) => {
  if (!googleBusinessEnabled()) return googleBusinessDisabledResponse();
  const creds = await getGoogleBusinessCredentials(session.organizationId);
  if (!creds) {
    return apiError(409, "not_connected", "Conecta Google Business antes de sincronizar");
  }
  const result = await syncOrganization(session.organizationId);
  if ("error" in result) {
    return apiError(422, "sync_failed", result.error);
  }
  return Response.json(result);
});
