import { getIntegration } from "@/server/integrations";
import { getGoogleCredentials } from "@/server/agenda/connectors/google-credentials";
import { agendaEnabled } from "@/server/agenda/flag";
import { getCapiSettings } from "@/server/attribution/settings";
import { atribucionEnabled } from "@/server/attribution/flag";
import { listEmailAccounts } from "@/server/email/service";
import { getGoogleBusinessCredentials } from "@/server/google-business/credentials";
import { googleBusinessEnabled } from "@/server/google-business/flag";
import { getMarketplaceCredentials } from "@/server/mercado-libre/credentials";
import { isChannelEnabled } from "@/server/channels/enabled";
import { getIntelCredentials } from "@/server/intel/credentials";
import { intelEnabled } from "@/server/intel/flag";

/**
 * Estado agregado de las conexiones que NO son de mensajería (Meta Ads, GA4,
 * Google Ads, Calendar, CAPI, Buzón). Fuente única para la UI
 * (`/api/settings/connections-status`) y las acciones MCP.
 *
 * "connected" = existe una configuración guardada; NO es una prueba en vivo
 * (mismo criterio que `/api/settings/diagnostics`). Nunca incluye secretos:
 * solo banderas de estado e identificadores públicos de la cuenta.
 */
export async function getConnectionsStatus(organizationId: string) {
  const [metaAds, ga4, googleAds, googleCreds, capi, emailAccounts, gbCreds, mlCreds, intelCreds] =
    await Promise.all([
      getIntegration(organizationId, "meta_ads"),
      getIntegration(organizationId, "ga4"),
      getIntegration(organizationId, "google_ads"),
      agendaEnabled() ? getGoogleCredentials(organizationId) : null,
      atribucionEnabled() ? getCapiSettings(organizationId) : null,
      listEmailAccounts(organizationId),
      googleBusinessEnabled() ? getGoogleBusinessCredentials(organizationId) : null,
      isChannelEnabled("mercado_libre") ? getMarketplaceCredentials(organizationId) : null,
      intelEnabled() ? getIntelCredentials(organizationId) : null,
    ]);

  const enabledEmailAccounts = emailAccounts.filter((account) => account.enabled);

  return {
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
      capi: !atribucionEnabled() ? "disabled" : capi ? "connected" : "not_configured",
      google_business: !googleBusinessEnabled()
        ? "disabled"
        : gbCreds
          ? gbCreds.status === "error"
            ? "reconnect_required"
            : "connected"
          : "not_configured",
      mercado_libre: !isChannelEnabled("mercado_libre")
        ? "disabled"
        : mlCreds
          ? mlCreds.status === "reconnect_required" || mlCreds.status === "error"
            ? "reconnect_required"
            : "connected"
          : "not_configured",
      intel: !intelEnabled() ? "disabled" : intelCreds ? "connected" : "not_configured",
      email: enabledEmailAccounts.length > 0 ? "connected" : "not_configured",
    },
    meta_ads_account: (metaAds?.credentials.adAccountId as string | null) ?? null,
    ga4_property: (ga4?.credentials.propertyId as string | null) ?? null,
    google_ads_customer: (googleAds?.credentials.customerId as string | null) ?? null,
    calendar_id: googleCreds?.calendarId ?? null,
    google_business_last_sync: gbCreds?.lastSyncedAt?.toISOString() ?? null,
    mercado_libre_last_polled: mlCreds?.lastPolledAt?.toISOString() ?? null,
    intel_last_ingest: intelCreds?.lastIngestAt?.toISOString() ?? null,
    email_accounts: enabledEmailAccounts.map((account) => account.email),
  };
}
