import { existsSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * Rutas de archivo bajo `MEDIA_DIR`, siempre contenidas en el directorio del
 * negocio.
 *
 * El regex de segmentos NO basta con excluir "/", porque la ruta pública
 * `/api/media/public/[orgId]/[...path]` llega descompuesta: un segmento `..`
 * (admisible por `[\w.-]`) escapaba del árbol con `join` y el endpoint, que no
 * pide sesión, leía cualquier archivo del contenedor —empezando por
 * `/proc/self/environ`, que contiene todos los secretos—. Por eso se valida
 * segmento a segmento, se normaliza con `resolve` y se exige que el resultado
 * siga dentro de la raíz, realpath mediante para descartar enlaces simbólicos.
 */

/** Nombre de archivo generado por la app: letra o dígito inicial, sin punto inicial. */
const SEGMENT = /^[A-Za-z0-9][\w.-]{0,127}$/;

/** Id de organización: nunca `.`/`..`, porque no puede empezar con punto. */
const ORG_ID = /^[A-Za-z0-9][\w-]{0,63}$/;

export function mediaRootDir(): string {
  return process.env.MEDIA_DIR ?? "/data/media";
}

function safeRealpath(target: string): string | undefined {
  try {
    return realpathSync(target);
  } catch {
    return undefined;
  }
}

/**
 * Ruta absoluta del archivo `orgId/…segments`, o `null` si algún segmento es
 * inválido o si la ruta resuelta sale del directorio del negocio.
 *
 * Devuelve la ruta aunque el archivo no exista (el llamador decide el 404): lo
 * que nunca devuelve es una ruta fuera del árbol.
 */
export function resolveMediaFile(orgId: string, ...segments: string[]): string | null {
  if (!ORG_ID.test(orgId) || segments.length === 0) return null;
  if (segments.some((segment) => !SEGMENT.test(segment))) return null;

  const root = resolve(mediaRootDir(), orgId);
  const candidate = resolve(root, ...segments);
  if (!candidate.startsWith(root + sep)) return null;
  if (!existsSync(candidate)) return candidate;

  // Un eslabón simbólico dentro del árbol podría apuntar fuera: se contrasta el
  // camino real del archivo contra el camino real de la raíz.
  const real = safeRealpath(candidate);
  if (real === undefined) return null;
  const realRoot = safeRealpath(root);
  if (realRoot !== undefined && !real.startsWith(realRoot + sep)) return null;
  return real;
}

/** Segmento único apto para escribir (id de asset, nombre de logo generado). */
export function isSafeMediaSegment(segment: string): boolean {
  return SEGMENT.test(segment);
}

/**
 * Cabeceras de una respuesta de media pública.
 *
 * El logo admite SVG y la subida la hace cualquier miembro del negocio: un SVG
 * con `<script>` servido en la raíz del CRM ejecutaría código con las cookies de
 * sesión de quien abra esa URL. `sandbox` desactiva scripts y formularios en el
 * documento sin romper el uso normal como `<img>`.
 */
export function mediaHeaders(mime: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": mime,
    "cache-control": "public, max-age=86400",
    "x-content-type-options": "nosniff",
  };
  if (mime === "image/svg+xml") {
    headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  }
  return headers;
}
