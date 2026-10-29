/**
 * Configuración del chat del sitio web (canal `webchat`).
 *
 * Vive en `lib/` porque la usan los tres lados: el formulario de Ajustes, la
 * API pública del widget y el propio panel embebido. Sin un normalizador
 * compartido, cada lado validaba a su manera y una clave guardada con espacios
 * dejaba de resolver en el endpoint público.
 *
 * Se guarda en `organization.metadata` (columna de texto) y no en una tabla
 * nueva a propósito: una migración más para cuatro campos de configuración no
 * se paga, y el patrón de lectura-modificación-escritura ya existe en
 * `server/business-settings.ts`.
 */

export type WebchatSettings = {
  /** Encendido por el operador: apagado, el widget responde «no disponible». */
  enabled: boolean;
  /** Llave pública que viaja en el snippet. Vacía hasta el primer guardado. */
  publicKey: string;
  /**
   * Orígenes autorizados a incrustar el widget. Vacío = cualquiera (cómodo para
   * probar); con valores, el envío exige que el `Origin` coincida.
   */
  allowedOrigins: string[];
  title: string;
  welcome: string;
};

export const WEBCHAT_DEFAULT: WebchatSettings = {
  enabled: false,
  publicKey: "",
  allowedOrigins: [],
  title: "Escríbenos",
  welcome: "¡Hola! Déjanos tu mensaje y te contestamos por aquí.",
};

export const WEBCHAT_TITLE_MAX = 60;
export const WEBCHAT_WELCOME_MAX = 300;
export const WEBCHAT_ORIGINS_MAX = 10;
export const WEBCHAT_TEXT_MAX = 2000;

/** La llave pública no es un secreto, pero sí tiene que ser difícil de adivinar. */
export const WEBCHAT_KEY_PATTERN = /^wc_[a-f0-9]{24}$/;

/**
 * El identificador del visitante lo genera su navegador y es, en la práctica,
 * el token con el que lee SU hilo. Se acepta un alfabeto corto y ancho fijo
 * para que no pueda usarse como consulta arbitraria.
 */
export const WEBCHAT_VISITOR_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function asString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Un origen es esquema + host + puerto, sin ruta. Se acepta lo que la gente
 * escribe («midominio.com») y se completa con https, porque exigir el esquema
 * escrito a mano solo producía listas que no coincidían con nada.
 */
export function normalizeOrigin(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  const withScheme = /^https?:\/\//.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function normalizeWebchatSettings(raw: unknown): WebchatSettings {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const origins: string[] = [];
  if (Array.isArray(source.allowedOrigins)) {
    for (const entry of source.allowedOrigins) {
      if (typeof entry !== "string") continue;
      const origin = normalizeOrigin(entry);
      if (origin && !origins.includes(origin)) origins.push(origin);
      if (origins.length >= WEBCHAT_ORIGINS_MAX) break;
    }
  }
  const publicKey = asString(source.publicKey, 64).toLowerCase();
  return {
    enabled: source.enabled === true,
    publicKey: WEBCHAT_KEY_PATTERN.test(publicKey) ? publicKey : "",
    allowedOrigins: origins,
    title: asString(source.title, WEBCHAT_TITLE_MAX) || WEBCHAT_DEFAULT.title,
    welcome: asString(source.welcome, WEBCHAT_WELCOME_MAX) || WEBCHAT_DEFAULT.welcome,
  };
}

/** Snippet que el dueño pega antes de `</body>` en su sitio. */
export function webchatSnippet(baseUrl: string, publicKey: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `<script src="${base}/widget/webchat.js" data-key="${publicKey}" async></script>`;
}
