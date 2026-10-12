"use client";

import { Target, TrendingUp } from "lucide-react";
import { KpiCard, formatNumber } from "./kpi-card";
import { ChartCard } from "./chart-card";

interface Conversions { sent: number; pending: number; failed: number }
interface Ads {
  attributedLeads: number;
  attributedConversations: number;
  convertedFromAds: number;
  conversions: Conversions;
}

/**
 * Atribución de anuncios y estado de Conversiones API. El gasto real, CAC y
 * ROAS de Meta Ads viven en el Campaign Explorer (Comercial · Publicidad); aquí
 * solo se muestra lo que el CRM atribuye internamente.
 */
export function AdsMetricsSection({ ads }: { ads: Ads }) {
  const converted = ads.convertedFromAds ?? 0;
  const totalConversions = (ads.conversions?.sent ?? 0) + (ads.conversions?.pending ?? 0) + (ads.conversions?.failed ?? 0);

  return (
    <ChartCard title="Atribución de anuncios">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard title="Leads atribuidos a ads" value={formatNumber(ads.attributedLeads ?? 0)} icon={<TrendingUp />}
          subtitle={`${formatNumber(ads.attributedConversations ?? 0)} conversaciones`} />
        <KpiCard title="Conversiones desde ads" value={formatNumber(converted)} icon={<Target />}
          subtitle="clientes ganados con origen en ads" />
        <KpiCard title="Conversiones (CAPI)" value={formatNumber(totalConversions)}
          subtitle={`${ads.conversions?.sent ?? 0} enviadas · ${ads.conversions?.failed ?? 0} fallidas`} />
      </div>

      <p className="mt-3 rounded-md bg-subtle p-2.5 text-[11px] leading-relaxed text-text-2">
        El gasto real, CAC, ROAS y métricas por campaña de Meta Ads están en
        <span className="font-medium"> Comercial · Publicidad</span>. Aquí solo ves la atribución interna del CRM y el estado de Conversiones API.
      </p>
    </ChartCard>
  );
}
