import { z } from "zod";
import { sql } from "drizzle-orm";
import { withOwner, parseBody, apiError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { whatsappProvider } from "@/server/whatsapp/provider";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { getInstagramCredentialsByOrg } from "@/server/instagram/credentials";
import { getMessengerCredentialsByOrg } from "@/server/messenger/credentials";
import { getTikTokCredentialsByOrg } from "@/server/tiktok/credentials";
import { getWahaCredentialsByOrg } from "@/server/waha/credentials";
import {
  getWhatsappZernio,
  zernioWhatsappEnabled,
} from "@/server/whatsapp/zernio-credentials";
import { enabledChannels } from "@/server/channels/enabled";

export const dynamic = "force-dynamic";

/**
 * `created_at` es `timestamp without time zone` y guarda UTC. Sin sufijo, el
 * navegador lo interpreta como hora local y adelanta/atrasa el evento; aquí se
 * serializa siempre como ISO UTC para que el cliente lo convierta bien.
 */
function asUtcIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const raw = String(value);
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const parsed = new Date(`${raw.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export const GET = withOwner(async (session, req: Request) => {
  const params = new URL(req.url).searchParams;
  const query = z.object({ source: z.string().regex(/^[a-z_]+$/).max(40).optional(), severity: z.enum(["info", "warning", "error"]).optional(), before: z.string().datetime().optional() })
    .safeParse(Object.fromEntries(params));
  if (!query.success) return apiError(422, "invalid_filter", "Filtros no válidos");
  const db = getDb();
  const { source, severity, before } = query.data;
  const events = await db.execute(sql`SELECT id, source, severity, code, message, metadata, resolved_at::text AS resolved_at, created_at::text AS created_at FROM diagnostic_event
    WHERE organization_id=${session.organizationId} AND created_at >= now() - interval '30 days'
    ${source ? sql`AND source=${source}` : sql``} ${severity ? sql`AND severity=${severity}` : sql``}
    ${before ? sql`AND created_at < (${before}::timestamptz AT TIME ZONE 'UTC')` : sql``}
    ORDER BY created_at DESC, id DESC LIMIT 51`);
  // El estado sale de las mismas funciones que usan los canales para enviar:
  // una fila cuyo cifrado no abre cuenta como "sin configurar", no como
  // "conectada". Antes se leía la columna `status` en crudo y esta pantalla
  // decía "Credenciales guardadas" de tokens que ningún conector podía usar.
  const zernioOn = zernioWhatsappEnabled();
  const [email, meta, waha, instagram, messenger, tiktok, zernio] = await Promise.all([
    db.execute(sql`SELECT count(*)::int AS count FROM email_account WHERE organization_id=${session.organizationId} AND enabled`),
    getCredentialsByOrg(session.organizationId),
    getWahaCredentialsByOrg(session.organizationId),
    getInstagramCredentialsByOrg(session.organizationId),
    getMessengerCredentialsByOrg(session.organizationId),
    getTikTokCredentialsByOrg(session.organizationId),
    zernioOn ? getWhatsappZernio(session.organizationId) : Promise.resolve(null),
  ]);
  const zernioStatus = !zernioOn ? "disabled" : zernio ? "connected" : "not_configured";
  const page = events.slice(0, 50).map((event) => ({
    ...event,
    created_at: asUtcIso(event.created_at),
    resolved_at: asUtcIso(event.resolved_at),
  }));
  // Credential status is explicitly not a live connection test.
  return Response.json({ events: page, nextCursor: events.length > 50 ? asUtcIso(events[49]?.created_at) : null,
    status: { database: "Disponible", provider: await whatsappProvider(session.organizationId), channels: [...enabledChannels()], zernio: zernioStatus, meta: meta?.status ?? "not_configured", waha: waha?.status ?? "not_configured", instagram: instagram?.status ?? "not_configured", messenger: messenger?.status ?? "not_configured", tiktok: tiktok?.status ?? "not_configured", emailAccounts: email[0]?.count ?? 0 }, retentionDays: 30 });
});

export const PATCH = withOwner(async (session, req: Request) => {
  const parsed = await parseBody(req, z.object({ id: z.string().uuid(), resolved: z.boolean() }));
  if (!parsed.ok) return parsed.response;
  // `now()` en SQL evita enviar un Date por el protocolo extendido de
  // postgres.js (lo rechaza con ERR_INVALID_ARG_TYPE).
  const rows = await getDb().execute(sql`UPDATE diagnostic_event
    SET resolved_at = CASE WHEN ${parsed.data.resolved} THEN now() ELSE NULL END
    WHERE organization_id=${session.organizationId} AND id=${parsed.data.id} RETURNING id`);
  return rows.length ? Response.json({ ok: true }) : apiError(404, "not_found", "Evento no encontrado");
});
