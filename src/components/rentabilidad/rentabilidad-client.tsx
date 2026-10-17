"use client";

import { useCallback, useEffect, useState } from "react";
import { DollarSign, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ProjectMargin {
  projectId: string;
  projectName: string;
  revenue: number;
  cost: number;
  margin: number | null;
  marginPercent: number | null;
  grossMargin: number | null;
  grossMarginPercent: number | null;
}

interface CampaignMargin {
  campaignId: string;
  campaignName: string;
  plannedSpend: number;
  actualSpend: number;
  variance: { diffCents: number; percent: number | null };
  revenue: number;
  cost: number;
  margin: number | null;
  marginPercent: number | null;
}

function formatMXN(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount / 100);
}

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}%`;
}

function marginBadge(margin: number | null, marginPercent: number | null) {
  if (margin === null) return <Badge variant="secondary">Sin datos</Badge>;
  if (margin >= 0) return <Badge variant="success">+{formatMXN(margin)} ({formatPercent(marginPercent)})</Badge>;
  return <Badge variant="warning">{formatMXN(margin)} ({formatPercent(marginPercent)})</Badge>;
}

export function RentabilidadClient() {
  const [period, setPeriod] = useState("30d");
  const [projectMargins, setProjectMargins] = useState<ProjectMargin[]>([]);
  const [campaignMargins, setCampaignMargins] = useState<CampaignMargin[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/metrics/profitability?period=${period}`).catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as {
        projectMargins: ProjectMargin[];
        campaignMargins: CampaignMargin[];
      };
      setProjectMargins(data.projectMargins);
      setCampaignMargins(data.campaignMargins);
    }
    setLoading(false);
  }, [period]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Rentabilidad</h1>
          <p className="text-muted-foreground">
            Márgenes por proyecto y campaña
          </p>
        </div>
        <div className="flex gap-2">
          {(["7d", "30d", "90d", "1y"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-md text-sm ${
                period === p
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          {/* Márgenes por proyecto */}
          <div className="rounded-lg border bg-card">
            <div className="p-4 border-b">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
                <h2 className="font-semibold">Márgenes por proyecto</h2>
              </div>
            </div>
            {projectMargins.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No hay proyectos en este período
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-3 text-left font-medium">Proyecto</th>
                      <th className="p-3 text-right font-medium">Ingreso</th>
                      <th className="p-3 text-right font-medium">Costo</th>
                      <th className="p-3 text-right font-medium">Margen</th>
                      <th className="p-3 text-right font-medium">Margen %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectMargins.map((pm) => (
                      <tr key={pm.projectId} className="border-b last:border-0">
                        <td className="p-3">{pm.projectName}</td>
                        <td className="p-3 text-right">{formatMXN(pm.revenue)}</td>
                        <td className="p-3 text-right">{formatMXN(pm.cost)}</td>
                        <td className="p-3 text-right">
                          {pm.margin !== null ? formatMXN(pm.margin) : "—"}
                        </td>
                        <td className="p-3 text-right">
                          {marginBadge(pm.margin, pm.marginPercent)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Varianza de presupuesto por campaña */}
          <div className="rounded-lg border bg-card">
            <div className="p-4 border-b">
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-muted-foreground" />
                <h2 className="font-semibold">Campañas</h2>
              </div>
            </div>
            {campaignMargins.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No hay campañas en este período
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-3 text-left font-medium">Campaña</th>
                      <th className="p-3 text-right font-medium">Presupuesto</th>
                      <th className="p-3 text-right font-medium">Gastado</th>
                      <th className="p-3 text-right font-medium">Varianza</th>
                      <th className="p-3 text-right font-medium">Ingreso</th>
                      <th className="p-3 text-right font-medium">Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignMargins.map((cm) => (
                      <tr key={cm.campaignId} className="border-b last:border-0">
                        <td className="p-3">{cm.campaignName}</td>
                        <td className="p-3 text-right">{formatMXN(cm.plannedSpend)}</td>
                        <td className="p-3 text-right">{formatMXN(cm.actualSpend)}</td>
                        <td className="p-3 text-right">
                          {cm.variance.percent !== null ? (
                            <Badge variant={cm.variance.diffCents >= 0 ? "success" : "warning"}>
                              {cm.variance.diffCents >= 0 ? "+" : ""}
                              {formatMXN(cm.variance.diffCents)} ({formatPercent(cm.variance.percent)})
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-3 text-right">{formatMXN(cm.revenue)}</td>
                        <td className="p-3 text-right">
                          {marginBadge(cm.margin, cm.marginPercent)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
