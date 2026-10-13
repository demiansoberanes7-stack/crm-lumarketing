"use client";

import { type ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function KpiCard({ title, value, subtitle, icon, trend, trendValue, origin, window: windowLabel, className }: KpiCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 pb-2 pt-4 sm:px-5">
        <CardTitle title={title} className="line-clamp-2 min-w-0 leading-snug text-xs font-medium text-muted-foreground">{title}</CardTitle>
        {icon && <div className="h-4 w-4 shrink-0 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</div>}
      </CardHeader>
      <CardContent className="min-w-0 px-3 pb-4 sm:px-5">
        <div title={String(value)} className="truncate text-xl font-bold tabular-nums sm:text-2xl">{value}</div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          {trend === "up" && <ArrowUp className="h-3 w-3 text-emerald-500" />}
          {trend === "down" && <ArrowDown className="h-3 w-3 text-red-500" />}
          {trend === "neutral" && <Minus className="h-3 w-3 text-muted-foreground" />}
          {trendValue && (
            <p className={cn("text-xs", trend === "up" && "text-emerald-500", trend === "down" && "text-red-500")}>
              {trendValue}
            </p>
          )}
          {subtitle && !trendValue && (
            <p title={subtitle} className="line-clamp-2 min-w-0 text-xs leading-snug text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {(origin || windowLabel) && (
          <p className="mt-1.5 truncate text-[10px] uppercase tracking-wide text-muted-foreground/80">
            {[origin, windowLabel].filter(Boolean).join(" · ")}
          </p>
        )}
      </CardContent>
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
