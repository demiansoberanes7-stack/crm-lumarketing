import type { ReactNode } from "react";
import Image from "next/image";
import "./zorro-auth.css";

/**
 * Pantalla de acceso de Zorro Tech.
 *
 * Rediseño visual (dos paneles: marca a la izquierda, formulario a la derecha,
 * zorro sentado sobre el borde superior de la tarjeta). La autenticación real
 * vive en cada página (login/register) y NO cambia aquí: este layout solo
 * aporta la escenografía y el contorno responsivo.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <main className="zx-page">
      <section className="zx-brand" aria-label="Zorro Tech">
        <div className="zx-brand-inner">
          <span className="zx-name" aria-label="Zorro Tech">
            ZORRO <span className="zx-tech">TECH</span>
          </span>
          <p className="zx-tagline">CRM multicanal de venta</p>
          <span className="zx-accent" aria-hidden="true" />
        </div>
      </section>

      <section className="zx-form-panel" aria-label="Acceso a tu cuenta">
        {/* Sentado sobre el borde superior de la tarjeta (z-index 2 sobre la
            tarjeta z-index 1). Sin interacción: es decoración. El tamaño real
            lo manda el CSS (.zx-fox); width/height solo fijan la proporción. */}
        <Image
          className="zx-fox"
          src="/zorro-fox.png"
          alt="Zorro naranja con lentes, sudadera negra y pantalón azul, sentado"
          width={640}
          height={471}
          priority
        />
        {children}
      </section>
    </main>
  );
}
