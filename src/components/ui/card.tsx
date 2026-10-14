import { cn } from "@/lib/utils";

/**
 * Tarjetas al estilo del starter: borde fino, sombra mínima (xs) y radio
 * amplio. `CardAction` vive a la derecha del título (badge de tendencia);
 * `CardFooter` es el insight en dos líneas del KPI. `stat-card` agrega el
 * gradiente sutil del acento (ver globals.css).
 */
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card text-card-foreground shadow-xs",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-1.5 p-5", className)} {...props} />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-[15px] font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
}

/** Badge o botón alineado a la derecha del encabezado (tendencia del KPI). */
export function CardAction({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ml-auto shrink-0", className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

/** Número grande del KPI: tabular, semibold, escala con el contenedor. */
export function CardMetric({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-5 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl",
        className
      )}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

/** Insight del KPI: línea fuerte + línea secundaria, con separador superior. */
export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 border-t border-border px-5 py-3 text-sm",
        className
      )}
      {...props}
    />
  );
}
