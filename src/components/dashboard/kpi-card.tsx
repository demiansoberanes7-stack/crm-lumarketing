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
  className?: string;
}

export function KpiCard({ title, value, subtitle, icon, trend, trendValue, className }: KpiCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
        {icon && <div className="h-4 w-4 text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <div className="flex items-center gap-1.5 mt-1">
          {trend === "up" && <ArrowUp className="h-3 w-3 text-emerald-500" />}
          {trend === "down" && <ArrowDown className="h-3 w-3 text-red-500" />}
          {trend === "neutral" && <Minus className="h-3 w-3 text-muted-foreground" />}
          {trendValue && (
            <p className={cn("text-xs", trend === "up" && "text-emerald-500", trend === "down" && "text-red-500")}>
              {trendValue}
            </p>
          )}
          {subtitle && !trendValue && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
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
