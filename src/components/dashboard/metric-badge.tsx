import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Separación de métricas por origen.
 *
 * - `system`: calculadas por el propio CRM (pagos, gastos, embudo, proyectos…).
 * - `external`: leídas de una plataforma externa en vivo o sincronizadas
 *   (Meta Ads, GA4, Google Ads).
 * - `mixed`: cruzan ambas fuentes (p. ej. atribución: un lead interno nacido
 *   de una campaña externa).
 *
 * El badge y la leyenda dejan visible, en cada bloque del dashboard, de dónde
 * sale el número — sin reestructurar los departamentos.
 */

export type MetricOrigin = "system" | "external" | "mixed";

const ORIGIN_META: Record<MetricOrigin, { label: string; dot: string; chip: string }> = {
  system: {
    label: "Sistema",
    dot: "bg-slate-400",
    chip: "bg-muted text-muted-foreground border-border",
  },
  external: {
    label: "Externa",
    dot: "bg-blue-500",
    chip: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",
  },
  mixed: {
    label: "Mixta",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  },
};

export function originLabel(origin: MetricOrigin): string {
  return ORIGIN_META[origin].label;
}

/** Pill compacto que etiqueta el origen de una métrica o sección. */
export function MetricBadge({ origin, className }: { origin: MetricOrigin; className?: string }) {
  const meta = ORIGIN_META[origin];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none",
        meta.chip,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

const ORIGIN_DESCRIPTION: Record<MetricOrigin, string> = {
  system: "Calculado por el CRM (pagos, gastos, embudo, proyectos).",
  external: "Leído de Meta Ads, GA4 u otra plataforma.",
  mixed: "Cruza datos externos con el CRM (atribución).",
};

/** Leyenda global: explica los tres orígenes una sola vez, arriba del dashboard. */
export function OriginLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border bg-muted/30 px-3 py-2">
      <span className="text-[11px] font-medium text-muted-foreground">Origen de las métricas:</span>
      {(Object.keys(ORIGIN_META) as MetricOrigin[]).map((origin) => (
        <span key={origin} className="flex items-center gap-1.5" title={ORIGIN_DESCRIPTION[origin]}>
          <MetricBadge origin={origin} />
          <span className="hidden text-[10px] text-muted-foreground sm:inline">{ORIGIN_DESCRIPTION[origin]}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Sub-agrupa secciones por origen dentro de un departamento: encabezado breve
 * con el badge + el contenido. Da lectura visual de qué bloques son internos,
 * externos o mixtos sin moverlos de departamento.
 */
export function OriginGroup({
  origin,
  label,
  children,
  className,
}: {
  origin: MetricOrigin;
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <MetricBadge origin={origin} />
        {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
      </div>
      {children}
    </div>
  );
}
