import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getIntegration } from "@/server/integrations";
import { fetchMetaCampaignInsights, type MetaCredentials } from "@/server/ads/meta-insights";

/**
 * Sincroniza las insights diarias de las campañas de Meta Ads hacia
 * `campaign_insight`. Idempotente (constitución IV): el upsert va dirigido al
 * índice único (org, platform, campaña, día), así que un segundo barrido no
 * duplica nada y solo refresca los importes.
 */

export type SyncResult =
  | { ok: true; upserted: number }
  | { ok: false; reason: "not_configured" | "meta_error"; detail?: string; status?: number };

export async function syncMetaAdsInsights(
  organizationId: string,
  options: { datePreset?: string } = {}
): Promise<SyncResult> {
  const integration = await getIntegration(organizationId, "meta_ads");
  const credentials = (integration?.credentials ?? {}) as MetaCredentials;
  if (!credentials.accessToken || !credentials.adAccountId) {
    return { ok: false, reason: "not_configured" };
  }

  const result = await fetchMetaCampaignInsights(credentials, options);
  if (!result.ok) {
    return { ok: false, reason: "meta_error", detail: result.detail, status: result.status };
  }

  const db = getDb();
  let upserted = 0;
  const now = new Date();

  for (const insight of result.campaigns) {
    const row = {
      id: newId("campaignInsight"),
      organizationId,
      platform: "meta_ads",
      campaignExternalId: insight.campaignExternalId,
      campaignName: insight.campaignName,
      campaignObjective: insight.campaignObjective,
      status: insight.status,
      dateStart: insight.dateStart,
      dateStop: insight.dateStop,
      currency: insight.currency,
      spendCents: insight.spendCents,
      impressions: insight.impressions,
      reach: insight.reach,
      clicks: insight.clicks,
      uniqueClicks: insight.uniqueClicks,
      conversions: insight.conversions,
      conversionValueCents: insight.conversionValueCents,
      videoViews: insight.videoViews,
      thruplay: insight.thruplay,
      avgWatchTimeMs: insight.avgWatchTimeMs,
      videoP25: insight.videoP25,
      videoP50: insight.videoP50,
      videoP75: insight.videoP75,
      videoP100: insight.videoP100,
      actions: insight.actions ?? null,
      raw: insight.raw,
      syncedAt: now,
    };

    await db
      .insert(schema.campaignInsight)
      .values(row)
      .onConflictDoUpdate({
        target: [
          schema.campaignInsight.organizationId,
          schema.campaignInsight.platform,
          schema.campaignInsight.campaignExternalId,
          schema.campaignInsight.dateStart,
        ],
        set: {
          campaignName: row.campaignName,
          campaignObjective: row.campaignObjective,
          status: row.status,
          dateStop: row.dateStop,
          currency: row.currency,
          spendCents: row.spendCents,
          impressions: row.impressions,
          reach: row.reach,
          clicks: row.clicks,
          uniqueClicks: row.uniqueClicks,
          conversions: row.conversions,
          conversionValueCents: row.conversionValueCents,
          videoViews: row.videoViews,
          thruplay: row.thruplay,
          avgWatchTimeMs: row.avgWatchTimeMs,
          videoP25: row.videoP25,
          videoP50: row.videoP50,
          videoP75: row.videoP75,
          videoP100: row.videoP100,
          actions: row.actions,
          raw: row.raw,
          syncedAt: now,
        },
      });
    upserted += 1;
  }

  return { ok: true, upserted };
}

/** Organizaciones que tienen credenciales de Meta Ads guardadas. */
export async function listOrganizationsWithMetaAds(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ organizationId: schema.integration.organizationId })
    .from(schema.integration)
    .where(eq(schema.integration.provider, "meta_ads"));
  return rows.map((r) => r.organizationId);
}
