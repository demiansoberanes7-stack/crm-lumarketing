import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { markSourceTestResult } from "@/server/intel/credentials";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { verifyYoutubeKey } from "@/server/intel/sources/youtube";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ youtubeKey: z.string().trim().min(1) });

/**
 * Prueba en vivo de la API key de YouTube: lee el feed popular de MX (1 unidad
 * de cuota). Guarda el resultado en `youtube_status` para el badge verde/rojo.
 */
export const POST = withOwner(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  let ok = false;
  try {
    await verifyYoutubeKey(body.data.youtubeKey);
    ok = true;
  } catch {
    ok = false;
  }
  await markSourceTestResult(session.organizationId, "youtube", ok);
  if (!ok) {
    return apiError(422, "yt_test_failed", "YouTube rechazó la API key.");
  }
  return Response.json({ ok: true });
});
