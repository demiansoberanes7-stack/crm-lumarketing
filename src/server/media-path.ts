import { existsSync, readFileSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { CATALOG_DIR } from "@/lib/product-images";

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
 * Lo que se puede servir **sin sesión**.
 *
 * El volumen de media es plano por negocio y ahí conviven dos cosas con grados
 * de secreto opuestos: el logo (`logo-*` en la raíz) y las fotos del catálogo
 * (`catalog/…`) son públicas; los adjuntos del buzón se guardan en la raíz con
 * su `media_asset.id` y **son de quien escribió al negocio**. Antes esta ruta no
 * distinguía: `GET /api/media/public/{org}/{assetId}` sin cookies devolvía la
 * foto que mandó un cliente, porque el id del asset aparece en URLs de mensaje,
 * en logs y en el payload que reenvían algunos proveedores. Un id de 20 cifras
 * no es una contraseña.
 *
 * Lista corta y explícita: lo nuevo que se quiera publicar se añade aquí, con
 * su consumidor al lado, en vez de servir todo lo que caiga dentro del árbol.
 */
export function isPublicMediaPath(segments: string[]): boolean {
  if (segments.length === 0) return false;
  if (segments[0] === CATALOG_DIR) {
    return segments.length === 2;
  }
  return segments.length === 1 && segments[0]!.startsWith("logo-");
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
 * Borra el árbol de archivos de un negocio ya eliminado en BD.
 *
 * Se llama SIEMPRE después del commit: si el borrado de la fila falla, la media
 * debe seguir ahí. No sigue enlaces simbólicos (rm retira el enlace, no su
 * destino) y exige que el id sea un segmento de organización válido.
 */
export async function removeOrganizationMedia(orgId: string): Promise<boolean> {
  if (!ORG_ID.test(orgId)) return false;
  const root = resolve(mediaRootDir());
  const dir = resolve(root, orgId);
  if (!dir.startsWith(root + sep)) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

/**
 * Respuesta de la media pública.
 *
 * Las dos rutas bajo `/api/media/public/[orgId]` (un segmento y catch-all)
 * hacían lo mismo por separado y divergieron: una conocía GIF y WEBP y la otra
 * no, así que el mismo archivo se veía distinto según cuántos segmentos tuviera
 * su URL. Aquí está la única implementación; la de un segmento es un alias
 * histórico porque esa forma es la que ya está guardada en `organization`.
 *
 * Lo que no está en la lista pública sale como **404, no 403**: esta ruta no
 * tiene sesión, y un 403 sería la confirmación gratis de que el archivo del
 * cliente existe. Lo mismo para la ruta inválida que para el archivo perdido.
 */
export function publicMediaResponse(orgId: string, segments: string[]): Response {
  if (!isPublicMediaPath(segments)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const filePath = resolveMediaFile(orgId, ...segments);
  if (filePath === null) {
    return Response.json({ error: "invalid path" }, { status: 422 });
  }
  let data: Buffer;
  try {
    data = readFileSync(filePath);
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const ext = segments.at(-1)?.split(".").pop()?.toLowerCase() ?? "";
  const mime = PUBLIC_MIME[ext] ?? "application/octet-stream";
  return new Response(new Uint8Array(data), { headers: mediaHeaders(mime) });
}

/** Lo que se sirve sin sesión; lo desconocido sale como archivo opaco. */
const PUBLIC_MIME: Record<string, string> = {
  png: "image/png",
  svg: "image/svg+xml",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

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

/**
 * Tipos que se pueden mostrar en el navegador sin ejecutar nada.
 *
 * Excluye `image/svg+xml` a propósito: es imagen para `<img>` pero documento
 * ejecutable si se abre en una pestaña, y aquí el binario lo trae un tercero.
 */
const INLINE_TYPES =
  /^(image\/(?!svg)[a-z0-9.+-]+|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|application\/pdf)$/i;

/**
 * El `content-type` con el que se sirve un adjunto, filtrado.
 *
 * El MIME guardado viene del payload del webhook (`media.mime_type` en
 * `src/server/inbox/ingest.ts`, o el `content-type` de la respuesta remota en
 * `src/server/whatsapp/media.ts`): lo elige quien envía el archivo, no
 * Lumarketing. Servirlo tal cual en la raíz del CRM —con `inline` y sesión de
 * quien hace clic— convierte un adjunto `text/html` en XSS con cookies
 * propias. Lo que no sea multimedia o PDF se baja como archivo opaco.
 */
export function assetContentType(mime: string | null | undefined): string {
  const bare = (mime ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return INLINE_TYPES.test(bare) ? bare : "application/octet-stream";
}

/**
 * Cabeceras del adjunto privado (`/api/media/[assetId]`).
 *
 * `inline` solo para lo filtrado arriba; el resto se fuerza a `attachment`
 * para que el navegador no lo interprete como documento de la aplicación.
 * `nosniff` va siempre, porque un `application/octet-stream` sin él vuelve a
 * adivinar tipo a partir del contenido.
 */
export function assetViewHeaders(
  storedMime: string | null | undefined,
  fileName?: string | null
): Record<string, string> {
  const type = assetContentType(storedMime);
  const inline = type !== "application/octet-stream";
  const safeName = (fileName ?? "").replace(/[^\w. -]/g, "_");
  return {
    "content-type": type,
    "x-content-type-options": "nosniff",
    // El contenido de un asset es inmutable; privado por sesión.
    "cache-control": "private, max-age=86400",
    ...(safeName
      ? { "content-disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"` }
      : {}),
  };
}
