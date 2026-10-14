import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import {
  deleteIntelCredentials,
  getIntelCredentials,
  saveIntelCredentials,
} from "@/server/intel/credentials";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { verifyYoutubeKey } from "@/server/intel/sources/youtube";

export const dynamic = "force-dynamic";

/**
 * API keys del módulo de inteligencia (YouTube + DENUE). Patrón Google
 * Business: el dueño pega las claves, se verifican contra YouTube antes de
 * guardar y jamás regresan al cliente (solo los últimos 4).
 */
export const GET = withOwner(async (session) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const creds = await getIntelCredentials(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      youtubeKeyLast4: creds.youtubeKey.slice(-4),
      youtubeStatus: creds.youtubeStatus,
      youtubeLastTestAt: creds.youtubeLastTestAt,
      denueConfigured: Boolean(creds.denueToken),
      denueStatus: creds.denueStatus,
      denueLastTestAt: creds.denueLastTestAt,
      gtEnabled: creds.gtEnabled,
      gtStatus: creds.gtStatus,
      gtLastTestAt: creds.gtLastTestAt,
      gtLastSyncAt: creds.gtLastSyncAt,
      lastIngestAt: creds.lastIngestAt,
      status: creds.status,
    },
  });
});

const credsSchema = z.object({
  youtubeKey: z.string().trim().min(1).optional().nullable(),
  denueToken: z.string().trim().min(1).optional().nullable(),
  gtEnabled: z.boolean().optional(),
});

export const PUT = withOwner(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const body = await parseBody(req, credsSchema);
  if (!body.ok) return body.response;

  const existing = await getIntelCredentials(session.organizationId);
  const newYtKey = body.data.youtubeKey?.trim() || null;

  // Si llega una key nueva de YouTube, verificarla antes de guardar. Si no
  // llega (guardado parcial de DENUE o GT), se conserva la existente.
  if (newYtKey) {
    try {
      await verifyYoutubeKey(newYtKey);
    } catch {
      return apiError(
        422,
        "intel_invalid_key",
        "YouTube rechazó la API key. Verifica que esté activa y con YouTube Data API v3 habilitado."
      );
    }
  }

  // Se requiere al menos una key de YouTube para crear credenciales nuevas.
  const ytKeyToSave = newYtKey ?? existing?.youtubeKey;
  if (!ytKeyToSave) {
    return apiError(400, "missing_youtube_key", "Se requiere la API key de YouTube.");
  }

  await saveIntelCredentials({
    organizationId: session.organizationId,
    youtubeKey: ytKeyToSave,
    denueToken: body.data.denueToken?.trim() || existing?.denueToken || null,
    gtEnabled: body.data.gtEnabled ?? existing?.gtEnabled ?? false,
  });
  return Response.json({ ok: true });
});

export const DELETE = withOwner(async (session) => {
  if (!intelEnabled()) return intelDisabledResponse();
  await deleteIntelCredentials(session.organizationId);
  return Response.json({ ok: true });
});
