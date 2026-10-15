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
 * GET: estado de todas las fuentes (SerpApi, Apify, INEGI, YouTube).
 * Los secretos jamás se devuelven completos; solo se expone si están
 * configurados y el estado de la última prueba en vivo.
 */
export const GET = withOwner(async (session) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const creds = await getIntelCredentials(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      youtubeConfigured: Boolean(creds.youtubeKey),
      youtubeKeyLast4: creds.youtubeKey ? creds.youtubeKey.slice(-4) : null,
      youtubeStatus: creds.youtubeStatus,
      youtubeLastTestAt: creds.youtubeLastTestAt,
      denueConfigured: Boolean(creds.denueToken),
      denueStatus: creds.denueStatus,
      denueLastTestAt: creds.denueLastTestAt,
      serpapiConfigured: Boolean(creds.serpapiKey),
      serpapiKeyLast4: creds.serpapiKey ? creds.serpapiKey.slice(-4) : null,
      serpapiStatus: creds.serpapiStatus,
      serpapiLastTestAt: creds.serpapiLastTestAt,
      serpapiLastSyncAt: creds.serpapiLastSyncAt,
      serpapiQueriesUsed: creds.serpapiQueriesUsed,
      apifyConfigured: Boolean(creds.apifyToken),
      apifyTokenLast4: creds.apifyToken ? creds.apifyToken.slice(-4) : null,
      apifyActorId: creds.apifyActorId,
      apifyStatus: creds.apifyStatus,
      apifyLastTestAt: creds.apifyLastTestAt,
      apifyLastSyncAt: creds.apifyLastSyncAt,
      apifyQueriesUsed: creds.apifyQueriesUsed,
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
  youtubeKey: z.string().trim().optional().nullable(),
  denueToken: z.string().trim().optional().nullable(),
  serpapiKey: z.string().trim().optional().nullable(),
  apifyToken: z.string().trim().optional().nullable(),
  apifyActorId: z.string().trim().max(255).optional().nullable(),
  gtEnabled: z.boolean().optional(),
});

/**
 * PUT: guardado parcial. Cada campo es opcional; si no llega, llega vacío
 * o enmascarado ("····") se conserva el existente — así «dejar en blanco
 * para mantener» de la UI no borra ni rechaza la credencial.
 * Ya NO se exige YouTube para crear credenciales.
 */
export const PUT = withOwner(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const body = await parseBody(req, credsSchema);
  if (!body.ok) return body.response;

  // Vacío o enmascarado = conservar lo que ya está guardado.
  const keep = (v: string | null | undefined): string | undefined => {
    const t = v?.trim() ?? "";
    return t && !t.startsWith("····") ? t : undefined;
  };

  // Si llega una key nueva de YouTube, verificarla antes de guardar.
  const newYtKey = keep(body.data.youtubeKey);
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

  await saveIntelCredentials({
    organizationId: session.organizationId,
    youtubeKey: newYtKey,
    denueToken: keep(body.data.denueToken),
    serpapiKey: keep(body.data.serpapiKey),
    apifyToken: keep(body.data.apifyToken),
    apifyActorId: keep(body.data.apifyActorId),
    gtEnabled: body.data.gtEnabled,
  });
  return Response.json({ ok: true });
});

export const DELETE = withOwner(async (session) => {
  if (!intelEnabled()) return intelDisabledResponse();
  await deleteIntelCredentials(session.organizationId);
  return Response.json({ ok: true });
});
