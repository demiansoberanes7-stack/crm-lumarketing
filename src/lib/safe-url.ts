/**
 * Esquema seguro para cualquier URL que entra por datos ajenos al CRM: el CSV
 * que sube un proveedor, el enlace de reunión que escribe un miembro, el sitio
 * que viene de una hoja de cálculo.
 *
 * Existe porque estos valores terminan en un `href` (`catalog-client.tsx`,
 * `bookings-client.tsx`, `suppliers-client.tsx`) y un `href` con `javascript:`
 * ejecuta código con la sesión de quien hace clic. El validador del formulario
 * individual (`productWebsiteUrlSchema`) ya lo impedía; la importación masiva y
 * los ajustes de agenda escribían directo a la BD y se saltaban esa defensa.
 */

/** Máximo realista para una URL escrita a mano; `body_html` no, esto es un enlace. */
const MAX_URL_LENGTH = 1024;

function canonicalHttpUrl(value: string): string | null {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  // `data:` también «se abre solo»: sirve para phishing y para SVG en línea.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  // Se devuelve la forma canónica: `URL` recorta espacios y quita saltos de
  // línea y tabuladores, que son justo los caracteres con los que se disfraza
  // un esquema (`java\nscript:alert(1)`).
  return parsed.href;
}

/**
 * La URL tal cual, solo si es HTTP(S) absoluta. `null` en cualquier otro caso:
 * el llamador decide si la descarta (importación) o si pinta texto sin enlace.
 */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return canonicalHttpUrl(raw.trim());
}

/**
 * `href` para un enlace salible, admitiendo el dominio escrito sin esquema
 * («micarro.com/tienda») como ya lo hacía la interfaz de proveedores.
 *
 * Devuelve `null` cuando no se puede convertir en enlace seguro: el componente
 * debe pintar texto plano, no un `href` vacío que apuntaría a la página propia.
 */
export function webHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  const exact = canonicalHttpUrl(value);
  if (exact) return exact;
  // Sin esquema: se presupone https y se valida la candidata resultante, no la
  // entrada cruda, para que el fallo de `new URL` siga significando «no enlace».
  if (/^[a-z0-9.-]/i.test(value)) return canonicalHttpUrl(`https://${value}`);
  return null;
}

/**
 * `href` de correo. Se rechaza cualquier valor con los caracteres que rompen la
 * sintaxis de `mailto:` (comas y `?` incluidas: `mailto:a@b.c?subject=…` ya no
 * es un destinatario sino un parámetro del enlace).
 */
export function mailtoHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!/^[^\s@,;<>?"']+@[^\s@,;<>?"']+\.[^\s@,;<>?"']+$/.test(value)) return null;
  return `mailto:${value}`;
}
