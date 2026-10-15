import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { getIntelCredentials, markSourceTestResult } from "@/server/intel/credentials";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { verifyYoutubeKey, YoutubeError } from "@/server/intel/sources/youtube";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ youtubeKey: z.string().trim().min(1) });

/**
 * Prueba en vivo de la API key de YouTube: lee el feed popular de MX (1 unidad
 * de cuota). Si la key viene enmascarada ("····xxxx"), usa la guardada en BD.
 * Guarda el resultado en `youtube_status` para el badge verde/rojo.
 */
export const POST = withOwner(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const raw = body.data.youtubeKey;
  let apiKey = raw;
  if (raw.startsWith("····")) {
    const creds = await getIntelCredentials(session.organizationId);
    if (!creds?.youtubeKey) {
      return apiError(422, "yt_not_saved", "Guarda la API key antes de probar la conexión.");
    }
    apiKey = creds.youtubeKey;
  }

  let ok = false;
  let reason = "YouTube rechazó la API key.";
  try {
    await verifyYoutubeKey(apiKey);
    ok = true;
  } catch (e) {
    ok = false;
    // Devuelve el motivo real de Google (API v3 deshabilitada, restricción,
    // cuota…) en vez del mensaje genérico, para que el dueño sepa qué tocar.
    if (e instanceof YoutubeError) reason = e.message;
  }
  await markSourceTestResult(session.organizationId, "youtube", ok);
  if (!ok) {
    return apiError(422, "yt_test_failed", reason);
  }
  return Response.json({ ok: true });
});
