import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Cabecera común de módulo.
 *
 * Antes cada pantalla repetía su propio `<header>` con el título de 17 px en
 * negrita: mismo contenido, cinco paddings distintos. Aquí el contexto del
 * módulo (`kicker`), el título, una línea de descripción y las acciones viven
 * en un solo sitio. `children` recibe la fila extra que algunas pantallas
 * necesitan (pestañas, filtros), para no volver a duplicar el borde.
 */
export function PageHeader({
  module,
  title,
  description,
  actions,
  children,
  className,
}: {
  /** Ruta de contexto, p. ej. «Comercial · Cotizador». */
  module?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "shrink-0 border-b bg-background px-4 py-3 sm:px-6 sm:py-3.5",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {module ? <p className="kicker">{module}</p> : null}
          <h1 className="mt-1 truncate text-[19px] font-semibold leading-tight tracking-[-0.02em]">
            {title}
          </h1>
          {description ? (
            <div className="mt-1 text-[12.5px] text-text-2">{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
