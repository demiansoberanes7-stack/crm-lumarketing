import { sql } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import { isChannelEnabled } from "@/server/channels/enabled";
import { whatsappProvider } from "@/server/whatsapp/provider";
import { zernioWhatsappEnabled } from "@/server/whatsapp/zernio-credentials";

export const dynamic = "force-dynamic";

type Status = "connected" | "not_configured" | "reconnect_required" | "disabled";

interface ChannelOption {
  id: Channel | "email";
  label: string;
  enabled: boolean;
  connected: boolean;
  status: Status;
}

/**
 * GET /api/automations/channels — qué cuentas puede usar una regla de
 * automatización. El selector de canal se construye con esto para mostrar
 * solo los canales que la instancia tiene encendidos y conectados.
 *
 * El estado es el de las credenciales guardadas, no una prueba en vivo
 * (mismo criterio que /api/settings/diagnostics).
 */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const org = session.organizationId;

  const [provider, meta, waha, instagram, messenger, tiktok, zernio, email] = await Promise.all([
    whatsappProvider(org),
    db.select({ status: schema.metaCredentials.status }).from(schema.metaCredentials).where(scoped(schema.metaCredentials.organizationId, org)).limit(1),
    db.select({ status: schema.wahaCredentials.status }).from(schema.wahaCredentials).where(scoped(schema.wahaCredentials.organizationId, org)).limit(1),
    db.select({ status: schema.instagramCredentials.status }).from(schema.instagramCredentials).where(scoped(schema.instagramCredentials.organizationId, org)).limit(1),
    db.select({ status: schema.messengerCredentials.status }).from(schema.messengerCredentials).where(scoped(schema.messengerCredentials.organizationId, org)).limit(1),
    db.select({ status: schema.tiktokCredentials.status }).from(schema.tiktokCredentials).where(scoped(schema.tiktokCredentials.organizationId, org)).limit(1),
    db.select({ accountId: schema.whatsappZernio.accountId }).from(schema.whatsappZernio).where(scoped(schema.whatsappZernio.organizationId, org)).limit(1),
    db.execute(sql`SELECT count(*)::int AS count FROM email_account WHERE organization_id=${org} AND enabled = true`),
  ]);

  const waStatus: Status =
    provider === "zernio"
      ? !zernioWhatsappEnabled()
        ? "disabled"
        : zernio[0]
          ? "connected"
          : "not_configured"
      : provider === "waha"
        ? (waha[0]?.status as Status | undefined) ?? "not_configured"
        : (meta[0]?.status as Status | undefined) ?? "not_configured";

  const rows: Array<{ id: Channel | "email"; status: Status }> = [
    { id: "whatsapp", status: waStatus },
    { id: "messenger", status: (messenger[0]?.status as Status | undefined) ?? "not_configured" },
    { id: "instagram", status: (instagram[0]?.status as Status | undefined) ?? "not_configured" },
    { id: "tiktok", status: (tiktok[0]?.status as Status | undefined) ?? "not_configured" },
    { id: "email", status: Number((email[0] as { count?: number } | undefined)?.count ?? 0) > 0 ? "connected" : "not_configured" },
  ];

  const options: ChannelOption[] = rows.map(({ id, status }) => {
    const enabled = id === "email" ? true : isChannelEnabled(id);
    return {
      id,
      label: id === "email" ? "Correo electrónico" : CHANNEL_LABEL[id],
      enabled,
      connected: enabled && status === "connected",
      status: enabled ? status : "disabled",
    };
  });

  return Response.json({ channels: options });
});
