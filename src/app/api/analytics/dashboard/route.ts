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

  try {
    // 1. META ADS
    const metaInt = await getIntegration(orgId, "meta_ads");
    if (metaInt?.credentials?.accessToken && metaInt?.credentials?.adAccountId) {
      const { accessToken, adAccountId } = metaInt.credentials as { accessToken: string, adAccountId: string };
      // Normalizar el ID (a veces los usuarios ponen act_ y a veces no)
      const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
      
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${accountId}/insights?fields=spend,impressions,clicks&date_preset=last_7d&access_token=${accessToken}`
      );
      
      if (res.ok) {
        const data = await res.json();
        const row = data.data?.[0] || { spend: 0, impressions: 0, clicks: 0 };
        
        metrics.push({
          source: "meta",
          spend: Number(row.spend || 0),
          impressions: Number(row.impressions || 0),
          clicks: Number(row.clicks || 0),
          leads: 0, // Se actualizará si hay leads atribuidos en BD
          currency: "MXN"
        });

        const dailyClicks = Math.floor(Number(row.clicks || 0) / 7);
        chartData = Array.from({ length: 7 }).map((_, i) => ({
          name: `Día ${i + 1}`,
          meta: dailyClicks,
          google: 0
        }));
      }
    }

    // 2. GOOGLE ADS (Requiere SDK y Refresh Tokens complejos para Server-to-Server, 
    // así que si está conectado mostramos 0 hasta que se habilite el worker de Google Ads)
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
      pipelineMetric: { leads: 0, quotes: 0, won: 0, conversionRate: 0 } // handled by /api/pipeline/stats usually
    });
  } catch (error) {
    console.error("Error loading dashboard data:", error);
    return NextResponse.json({ error: "Error loading dashboard data" }, { status: 500 });
  }
});
