import type { CSSProperties, ReactNode } from "react";
import { DEFAULT_BRANDING, resolveAccentSet } from "@/lib/branding";
import { getBrandingContextForRequest } from "@/server/branding";
import "./zorro-auth.css";

/**
 * Pantalla de acceso de la instancia.
 *
 * Dos paneles: marca a la izquierda, formulario a la derecha, con el sello de la
 * instancia apoyado sobre el borde superior de la tarjeta. La autenticación real
 * vive en cada página (login/register) y NO cambia aquí: este layout solo aporta
 * la escenografía y el contorno responsivo.
 *
 * La escenografía es white-label: el nombre, la inicial del sello y el acento
 * salen de la marca de la petición. Sin sesión (aquí es donde se está) manda la
 * regla pública —una sola organización en la instancia, marca neutra si hay
 * varias—, así que un cliente nunca ve la identidad de otro en la puerta. El
 * color se calcula para fondo CLARO aunque el usuario traiga el tema oscuro: esta
 * pantalla siempre es clara y el acento de tema oscuro está aclarado a propósito
 * para verse sobre negro.
 */
export default async function AuthLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const branding =
    (await getBrandingContextForRequest().catch(() => null))?.branding ??
    DEFAULT_BRANDING;
  const acento = resolveAccentSet(branding.accent, "light");

  const [primera, ...resto] = branding.name.split(" ");
  const sello = (branding.name.trim().charAt(0) || "C").toUpperCase();
  const estilo = {
    "--zx-accent": acento.accent,
    "--zx-hover": acento.hover,
    "--zx-soft": acento.soft,
    "--zx-text": acento.text,
    "--zx-fg": acento.fg,
  } as CSSProperties;

  return (
    <main className="zx-page" style={estilo}>
      <section className="zx-brand" aria-label={branding.name}>
        <div className="zx-brand-inner">
          <span className="zx-name">
            {primera}
            {resto.length > 0 && (
              <>
                {" "}
                <span className="zx-tech">{resto.join(" ")}</span>
              </>
            )}
          </span>
          <p className="zx-tagline">CRM multicanal de venta</p>
          <span className="zx-accent" aria-hidden="true" />
        </div>
      </section>

      <section className="zx-form-panel" aria-label="Acceso a tu cuenta">
        {/* Apoyado sobre el borde superior de la tarjeta (z-index 2 sobre la
            tarjeta z-index 1). Sin interacción: es decoración. La inicial sale de
            la marca; un `aria-hidden` basta porque el nombre ya está en el panel
            de al lado y en el `aria-label` de este. */}
        <span className="zx-mark" aria-hidden="true">
          {sello}
        </span>
        {children}
      </section>
    </main>
  );
}
