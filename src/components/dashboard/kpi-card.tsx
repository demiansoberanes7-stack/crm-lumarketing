"use client";

import { type ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardFooter, CardHeader, CardMetric, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  /** Fuente del dato (p. ej. "GA4", "CRM", "Meta Ads"). */
  origin?: string;
  /** Ventana de tiempo a la que aplica (p. ej. "30 días"). */
  window?: string;
  className?: string;
}

/**
 * KPI al estilo del starter: tarjeta con gradiente sutil del acento, badge
 * de tendencia a la derecha del título, número grande tabular y footer con
 * el insight (subtítulo o tendencia) + fuente/ventana.
 */
export function KpiCard({ title, value, subtitle, icon, trend, trendValue, origin, window: windowLabel, className }: KpiCardProps) {
  const TrendIcon = trend === "up" ? ArrowUp : trend === "down" ? ArrowDown : Minus;
  return (
    <Card className={cn("stat-card overflow-hidden", className)}>
      <CardHeader className="px-4 pb-1 pt-4 sm:px-5">
        <CardTitle title={title} className="line-clamp-2 min-w-0 leading-snug text-xs font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <CardAction>
          {trend && trendValue ? (
            <Badge
              variant="outline"
              className={cn(
                "gap-1 text-[11px] font-medium",
                trend === "up" && "text-success-text",
                trend === "down" && "text-danger-text",
                trend === "neutral" && "text-text-3"
              )}
            >
              <TrendIcon className="h-3 w-3" strokeWidth={2.2} />
              {trendValue}
            </Badge>
          ) : icon ? (
            <span className="text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardMetric className="truncate px-4 pb-3 sm:px-5" title={String(value)}>
        {value}
      </CardMetric>
      {(subtitle || origin || windowLabel) && (
        <CardFooter className="px-4 py-2.5 sm:px-5">
          {subtitle && !trendValue && (
            <p title={subtitle} className="line-clamp-1 font-medium text-foreground">
              {subtitle}
            </p>
          )}
          {trendValue && subtitle && (
            <p title={subtitle} className="line-clamp-1 text-muted-foreground">
              {subtitle}
            </p>
          )}
          {(origin || windowLabel) && (
            <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
              {[origin, windowLabel].filter(Boolean).join(" · ")}
            </p>
          )}
        </CardFooter>
      )}
    </Card>
  );
}

/** Formatea centavos a MXN */
export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
}

/** Formatea número entero */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat("es-MX").format(n);
}

/** Formatea porcentaje */
export function formatPercent(n: number | null): string {
  return n === null ? "N/D" : `${n.toFixed(1)}%`;
}
