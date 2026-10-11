import { withOwner } from "@/lib/api";
import { getIntegration } from "@/server/integrations";
import { getGoogleCredentials } from "@/server/agenda/connectors/google-credentials";
import { agendaEnabled } from "@/server/agenda/flag";
import { getCapiSettings } from "@/server/attribution/settings";
import { atribucionEnabled } from "@/server/attribution/flag";
import { listEmailAccounts } from "@/server/email/service";

export const dynamic = "force-dynamic";

/**
 * Estado agregado de las conexiones que NO son de mensajería (Meta Ads, GA4,
 * Google Ads, Calendar, CAPI, Buzón). A diferencia del tablero de
 * mensajería —que consulta endpoints por canal—, estas conexiones viven en
 * tablas propias, así que se resuelven aquí en una sola llamada.
 *
 * "connected" = existe una configuración guardada; NO es una prueba en vivo
 * (mismo criterio que `/api/settings/diagnostics`).
 */
export const GET = withOwner(async (session) => {
  const orgId = session.organizationId;
  const [metaAds, ga4, googleAds, googleCreds, capi, emailAccounts] = await Promise.all([
    getIntegration(orgId, "meta_ads"),
    getIntegration(orgId, "ga4"),
    getIntegration(orgId, "google_ads"),
    agendaEnabled() ? getGoogleCredentials(orgId) : null,
    atribucionEnabled() ? getCapiSettings(orgId) : null,
    listEmailAccounts(orgId),
  ]);

  const enabledEmailAccounts = emailAccounts.filter((a) => a.enabled);

  return Response.json({
    status: {
      meta_ads: metaAds ? "connected" : "not_configured",
      ga4: ga4 ? "connected" : "not_configured",
      google_ads: googleAds ? "connected" : "not_configured",
      calendar: !agendaEnabled()
        ? "disabled"
        : googleCreds
          ? googleCreds.status === "error"
            ? "reconnect_required"
            : "connected"
          : "not_configured",
      capi: !atribucionEnabled()
        ? "disabled"
        : capi
          ? "connected"
          : "not_configured",
      email: enabledEmailAccounts.length > 0
        ? "connected"
        : emailAccounts.length > 0
          ? "not_configured"
          : "not_configured",
    },
    meta_ads_account: metaAds?.credentials.adAccountId as string | null,
    ga4_property: ga4?.credentials.propertyId as string | null,
    google_ads_customer: googleAds?.credentials.customerId as string | null,
    calendar_id: googleCreds?.calendarId ?? null,
    email_accounts: enabledEmailAccounts.map((a) => a.email),
  });
});
