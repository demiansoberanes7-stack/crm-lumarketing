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
  youtubeKey: z.string().trim().min(1),
  denueToken: z.string().trim().min(1).optional().nullable(),
  gtEnabled: z.boolean().optional(),
});

export const PUT = withOwner(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const body = await parseBody(req, credsSchema);
  if (!body.ok) return body.response;

  // Verificación real antes de guardar: lee el feed popular con la key — si
  // el dueño pegó algo malo, lo sabe aquí y no se persiste nada.
  try {
    await verifyYoutubeKey(body.data.youtubeKey);
  } catch {
    return apiError(
      422,
      "intel_invalid_key",
      "YouTube rechazó la API key. Verifica que esté activa y con YouTube Data API v3 habilitado."
    );
  }

  await saveIntelCredentials({
    organizationId: session.organizationId,
    youtubeKey: body.data.youtubeKey,
    denueToken: body.data.denueToken?.trim() || null,
    gtEnabled: body.data.gtEnabled ?? false,
  });
  return Response.json({ ok: true });
});

export const DELETE = withOwner(async (session) => {
  if (!intelEnabled()) return intelDisabledResponse();
  await deleteIntelCredentials(session.organizationId);
  return Response.json({ ok: true });
});
