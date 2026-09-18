import { z } from "zod";
import { sql } from "drizzle-orm";
import { withOwner, parseBody, apiError } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { whatsappProvider } from "@/server/whatsapp/provider";
import { enabledChannels } from "@/server/channels/enabled";

export const dynamic = "force-dynamic";
export const GET = withOwner(async (session, req: Request) => {
  const params = new URL(req.url).searchParams;
  const query = z.object({ source: z.string().regex(/^[a-z_]+$/).max(40).optional(), severity: z.enum(["info", "warning", "error"]).optional(), before: z.string().datetime().optional() })
    .safeParse(Object.fromEntries(params));
  if (!query.success) return apiError(422, "invalid_filter", "Filtros no válidos");
  const db = getDb();
  const { source, severity, before } = query.data;
  const events = await db.execute(sql`SELECT id, source, severity, code, message, metadata, resolved_at, created_at FROM diagnostic_event
    WHERE organization_id=${session.organizationId} AND created_at >= now() - interval '30 days'
    ${source ? sql`AND source=${source}` : sql``} ${severity ? sql`AND severity=${severity}` : sql``}
    ${before ? sql`AND created_at < ${before}::timestamp` : sql``}
    ORDER BY created_at DESC, id DESC LIMIT 51`);
  const [meta, waha, email, instagram, messenger] = await Promise.all([
    db.select({ status: schema.metaCredentials.status }).from(schema.metaCredentials).where(scoped(schema.metaCredentials.organizationId, session.organizationId)).limit(1),
    db.select({ status: schema.wahaCredentials.status }).from(schema.wahaCredentials).where(scoped(schema.wahaCredentials.organizationId, session.organizationId)).limit(1),
    db.execute(sql`SELECT count(*)::int AS count FROM email_account WHERE organization_id=${session.organizationId}`),
    db.select({ status: schema.instagramCredentials.status }).from(schema.instagramCredentials).where(scoped(schema.instagramCredentials.organizationId, session.organizationId)).limit(1),
    db.select({ status: schema.messengerCredentials.status }).from(schema.messengerCredentials).where(scoped(schema.messengerCredentials.organizationId, session.organizationId)).limit(1),
  ]);
  // Credential status is explicitly not a live connection test.
  return Response.json({ events: events.slice(0, 50), nextCursor: events.length > 50 ? events[49]?.created_at : null,
    status: { database: "Disponible", provider: await whatsappProvider(session.organizationId), channels: [...enabledChannels()], meta: meta[0]?.status ?? "not_configured", waha: waha[0]?.status ?? "not_configured", instagram: instagram[0]?.status ?? "not_configured", messenger: messenger[0]?.status ?? "not_configured", emailAccounts: email[0]?.count ?? 0 }, retentionDays: 30 });
});

export const PATCH = withOwner(async (session, req: Request) => {
  const parsed = await parseBody(req, z.object({ id: z.string().uuid(), resolved: z.boolean() }));
  if (!parsed.ok) return parsed.response;
  const rows = await getDb().execute(sql`UPDATE diagnostic_event SET resolved_at=${parsed.data.resolved ? new Date() : null}
    WHERE organization_id=${session.organizationId} AND id=${parsed.data.id} RETURNING id`);
  return rows.length ? Response.json({ ok: true }) : apiError(404, "not_found", "Evento no encontrado");
});
