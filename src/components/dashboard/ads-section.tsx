"use client";

import { Megaphone, Target, TrendingUp } from "lucide-react";
import { KpiCard, formatCurrency, formatNumber } from "./kpi-card";
import { ChartCard } from "./chart-card";

interface Conversions { sent: number; pending: number; failed: number }
interface Ads {
  adSpendCents: number;
  byPlatform: { name: string; amount: number }[];
  attributedLeads: number;
  attributedConversations: number;
  convertedFromAds: number;
  conversions: Conversions;
}

const PLATFORM_LABEL: Record<string, string> = { meta: "Meta Ads", google: "Google Ads" };

/** Métricas de publicidad: CAC, atribución y estado de Conversiones API. */
export function AdsMetricsSection({ ads }: { ads: Ads }) {
  const spend = ads.adSpendCents ?? 0;
  const converted = ads.convertedFromAds ?? 0;
  // CAC = gasto en ads / clientes convertidos desde ads.
  const cac = spend > 0 && converted > 0 ? spend / converted : null;
  const totalConversions = (ads.conversions?.sent ?? 0) + (ads.conversions?.pending ?? 0) + (ads.conversions?.failed ?? 0);
  const hasAdsData = spend > 0 || ads.attributedLeads > 0 || totalConversions > 0;

  return (
    <ChartCard title="Publicidad y atribución">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="Inversión en ads" value={formatCurrency(spend)} icon={<Megaphone />}
          subtitle={spend === 0 ? "Sin gasto registrado" : `${ads.byPlatform.length} plataforma(s)`} />
        <KpiCard title="CAC (costo de adquisición)" value={cac != null ? formatCurrency(cac) : "N/D"} icon={<Target />}
          subtitle={cac == null ? "Se activa con gasto y conversiones" : `${converted} cliente(s) desde ads`} />
        <KpiCard title="Leads atribuidos a ads" value={formatNumber(ads.attributedLeads ?? 0)} icon={<TrendingUp />}
          subtitle={`${formatNumber(ads.attributedConversations ?? 0)} conversaciones`} />
        <KpiCard title="Conversiones (CAPI)" value={formatNumber(totalConversions)}
          subtitle={`${ads.conversions?.sent ?? 0} enviadas · ${ads.conversions?.failed ?? 0} fallidas`} />
      </div>

      {ads.byPlatform && ads.byPlatform.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inversión por plataforma</h4>
          <ul className="space-y-1">
            {ads.byPlatform.map((p) => (
              <li key={p.name} className="flex items-center justify-between text-sm">
                <span className="text-text-2">{PLATFORM_LABEL[p.name] ?? p.name}</span>
                <span className="tabular-nums font-medium">{formatCurrency(p.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 rounded-md bg-subtle p-2.5 text-[11px] leading-relaxed text-text-2">
        {!hasAdsData
          ? "Aún no hay datos de publicidad. Conecta Meta Ads y Google Ads en Conexiones y sincroniza campañas para ver inversión, CAC y atribución."
          : "La inversión usa el presupuesto planeado de las campañas. El CAC se calcula dividiendo la inversión entre los clientes convertidos desde ads."}
      </p>
    </ChartCard>
  );
}
