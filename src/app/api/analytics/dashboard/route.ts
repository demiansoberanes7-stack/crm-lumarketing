import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getIntegration } from "@/server/integrations";
import { getDb, schema } from "@/lib/db";
import { eq, and, gte } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const orgId = session.organizationId;
  const metrics = [];
  let chartData: any[] = [];
  const campaigns: any[] = [];

  try {
    const metaInt = await getIntegration(orgId, "meta_ads");
    if (metaInt?.credentials?.accessToken && metaInt?.credentials?.adAccountId) {
      const { accessToken, adAccountId } = metaInt.credentials as { accessToken: string, adAccountId: string };
      const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
      
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${accountId}/insights?fields=campaign_name,spend,impressions,clicks&date_preset=last_30d&level=campaign&access_token=${accessToken}`
      );
      
      if (res.ok) {
        const data = await res.json();
        const campaignsData = data.data || [];
        
        let totalSpend = 0;
        let totalImpressions = 0;
        let totalClicks = 0;

        for (const camp of campaignsData) {
          totalSpend += Number(camp.spend || 0);
          totalImpressions += Number(camp.impressions || 0);
          totalClicks += Number(camp.clicks || 0);
          campaigns.push({
            id: camp.campaign_id || Math.random().toString(),
            name: camp.campaign_name || "Campaña Desconocida",
            source: "meta",
            spend: Number(camp.spend || 0),
            impressions: Number(camp.impressions || 0),
            clicks: Number(camp.clicks || 0),
            currency: "MXN"
          });
        }
        
        metrics.push({
          source: "meta",
          spend: totalSpend,
          impressions: totalImpressions,
          clicks: totalClicks,
          leads: 0,
          currency: "MXN"
        });

        const dailyClicks = Math.floor(totalClicks / 7);
        chartData = Array.from({ length: 7 }).map((_, i) => ({
          name: `Día ${i + 1}`,
          meta: dailyClicks,
          google: 0,
          ga4: 0
        }));
      }
    }

    const googleInt = await getIntegration(orgId, "google_ads");
    if (googleInt?.credentials?.customerId) {
      metrics.push({
        source: "google",
        spend: 0,
        impressions: 0,
        clicks: 0,
        leads: 0,
        currency: "MXN"
      });
    }

    const ga4Int = await getIntegration(orgId, "ga4");
    if (ga4Int?.credentials?.propertyId) {
      metrics.push({
        source: "ga4",
        spend: 0,
        impressions: 0, // In GA4 this would be sessions/pageviews
        clicks: 0,
        leads: 0,
        currency: "MXN"
      });
    }

    // Si no hay datos, inicializar un chart vacío
    if (chartData.length === 0) {
      chartData = [
        { name: "Lun", meta: 0, google: 0 },
        { name: "Mar", meta: 0, google: 0 },
        { name: "Mie", meta: 0, google: 0 },
        { name: "Jue", meta: 0, google: 0 },
        { name: "Vie", meta: 0, google: 0 },
        { name: "Sab", meta: 0, google: 0 },
        { name: "Dom", meta: 0, google: 0 },
      ];
    }

    return NextResponse.json({
      metrics,
      chartData,
      campaigns,
      pipelineMetric: { leads: 0, quotes: 0, won: 0, conversionRate: 0 } // handled by /api/pipeline/stats usually
    });
  } catch (error) {
    console.error("Error loading dashboard data:", error);
    return NextResponse.json({ error: "Error loading dashboard data" }, { status: 500 });
  }
});
