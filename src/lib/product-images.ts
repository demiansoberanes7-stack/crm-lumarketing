import { getEnv } from "@/lib/env";

/**
 * Fotos de producto: qué se acepta, cómo se sabe que es verdad y cómo se
 * construye su ruta.
 *
 * Módulo **puro** a propósito (sin `fs`, sin BD): es la parte que decide si un
 * archivo entra en el disco del negocio, y eso se puede y se debe probar sin
 * base de datos. El I/O está en `src/server/catalog/images.ts`.
 */

/** Formatos que sabemos verificar por firma y que ningún navegador ejecuta. */
export const PRODUCT_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type ProductImageMime = (typeof PRODUCT_IMAGE_MIMES)[number];

/**
 * Sin `image/svg+xml`, aunque el logo del negocio sí lo admite: un SVG es un
 * documento y la subida la hace quien sea del negocio. Servirlo desde la raíz
 * del CRM con las cookies de quien lo abre es la vía clásica a ejecutar guiones
 * en la sesión de otro. `mediaHeaders()` ya lo neutraliza con `sandbox`, pero
 * aquí no hace falta ese riesgo: una foto de producto es siempre map of bits.
 */
const EXT_BY_MIME: Record<ProductImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function isProductImageMime(value: string): value is ProductImageMime {
  return (PRODUCT_IMAGE_MIMES as readonly string[]).includes(value);
}

/** Prefijo público dentro del volumen de media. Es lo que `/api/media/public` admite. */
export const CATALOG_DIR = "catalog";

/** Ruta relativa persistida en `product_image.storage_path`. */
export function catalogImagePath(id: string, mime: ProductImageMime): string {
  return `${CATALOG_DIR}/${id}.${EXT_BY_MIME[mime]}`;
}

/** URL que se pone en el `<img>`. Derivada, nunca guardada: cambia `MEDIA_DIR`, no la fila. */
export function catalogImageUrl(organizationId: string, storagePath: string): string {
  return `/api/media/public/${organizationId}/${storagePath}`;
}

/** `product_image.bytes` → límite configurable. En MB para que se escriba a mano en el panel. */
export function maxImageBytes(): number {
  return getEnv().PRODUCT_IMAGE_MAX_BYTES_MB * 1024 * 1024;
}

export function maxImagesPerProduct(): number {
  return getEnv().PRODUCT_IMAGE_MAX_PER_PRODUCT;
}

export type SniffedImage = {
  mime: ProductImageMime;
  /** null si la firma es válida pero la cabecera no se puede leer. */
  width: number | null;
  height: number | null;
};

/**
 * Qué es el archivo **de verdad**, por sus primeros bytes.
 *
 * El `content-type` que manda el navegador —o el que manda cualquier cliente—
 * no es prueba de nada: declarar `image/png` y subir HTML es la forma estándar
 * de colar un documento donde se espera una imagen. Si la firma no coincide con
 * ninguno de los cuatro formatos, se rechaza; nunca se "asume" JPEG.
 *
 * Las dimensiones se leen de la cabecera del propio formato, sin decodificar.
 * Sirven para que la rejilla reserve el cajón con la proporción correcta y el
 * cuadro no brinque cuando carga la foto. null no invalida la imagen.
 */
export function sniffProductImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 12) return null;
  const at = (i: number) => bytes[i] ?? -1;
  const ascii = (i: number, s: string) =>
    [...s].every((c, k) => at(i + k) === c.charCodeAt(0));
  const u16le = (i: number) => (at(i) < 0 || at(i + 1) < 0 ? null : at(i) | (at(i + 1) << 8));
  const u24le = (i: number) =>
    at(i + 2) < 0 ? null : at(i) | (at(i + 1) << 8) | (at(i + 2) << 16);
  const u32be = (i: number) =>
    at(i + 3) < 0 ? null : (at(i) * 0x1000000) + (at(i + 1) << 16) + (at(i + 2) << 8) + at(i + 3);

  // PNG: firma de 8 bytes e IHDR como primera cabecera.
  if (
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) {
    if (!ascii(12, "IHDR")) return { mime: "image/png", width: null, height: null };
    return { mime: "image/png", width: u32be(16), height: u32be(20) };
  }

  // JPEG: FF D8 FF. El tamaño está en el marcador SOF, que no tiene posición fija.
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    const dims = jpegDimensions(bytes);
    return { mime: "image/jpeg", width: dims?.width ?? null, height: dims?.height ?? null };
  }

  // WEBP: RIFF....WEBP + subtipo VP8 / VP8L / VP8X.
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) {
    if (ascii(12, "VP8X")) {
      const w = u24le(24);
      const h = u24le(27);
      return { mime: "image/webp", width: w === null ? null : w + 1, height: h === null ? null : h + 1 };
    }
    if (ascii(12, "VP8L")) {
      // Tras el byte 0x2f hay 14 bits de ancho-1 y 14 de alto-1, en un paquete de 4.
      const t = u32leAt(bytes, 21);
      return {
        mime: "image/webp",
        width: t === null ? null : (t & 0x3fff) + 1,
        height: t === null ? null : ((t >>> 14) & 0x3fff) + 1,
      };
    }
    if (ascii(12, "VP8 ")) {
      // Cabecera de clave: tres bytes de marco, sincronía 9D 01 2A y luego
      // ancho/alto de 16 bits con los dos bits altos reservados.
      const w = u16le(26);
      const h = u16le(28);
      return {
        mime: "image/webp",
        width: w === null ? null : w & 0x3fff,
        height: h === null ? null : h & 0x3fff,
      };
    }
    return { mime: "image/webp", width: null, height: null };
  }

  // GIF87a / GIF89a.
  if (ascii(0, "GIF8") && (at(4) === 0x37 || at(4) === 0x39) && at(5) === 0x61) {
    return { mime: "image/gif", width: u16le(6), height: u16le(8) };
  }

  return null;
}

function u32leAt(bytes: Uint8Array, i: number): number | null {
  if (bytes.length < i + 4) return null;
  return (
    (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)) >>> 0
  );
}

/**
 * Ancho/alto del primer SOF de un JPEG.
 *
 * Se caminan los segmentos saltando su longitud declarada, así que nunca se
 * entra en los datos comprimidos. Un JPEG truncado o mal formado da null y la
 * imagen se guarda igual: la firma ya dijo que es JPEG.
 */
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const at = (i: number) => (i < bytes.length ? (bytes[i] ?? -1) : -1);
  let p = 2;
  // Tope de vueltas: con segmentos de longitud mínima se podría iterar casi
  // tanto como bytes tiene el archivo; 64 marcadores de sobra para el primero.
  for (let guard = 0; guard < 64 && p + 9 < bytes.length; guard++) {
    if (at(p) !== 0xff) return null;
    const marker = at(p + 1);
    if (marker === -1) return null;
    // Relleno, SOI, EOI y los RST* no llevan longitud.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      p += 2;
      continue;
    }
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (at(p + 5) << 8) | at(p + 6);
      const width = (at(p + 7) << 8) | at(p + 8);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    const length = (at(p + 2) << 8) | at(p + 3);
    if (length < 2) return null;
    p += 2 + length;
  }
  return null;
}

export type ProductImageRejection = {
  code: "too_large" | "not_an_image" | "limit_reached" | "bad_alt_text";
  message: string;
};

/**
 * Todo lo que hay que decidir antes de tocar disco, sin tocar disco.
 *
 * `existingCount` lo pone el llamador (costaba una consulta aquí y empaña el
 * test); el topor por producto se comprueba **antes** de escribir, y la
 * inserción va bajo advisory lock en el servicio, para que dos subidas paralelas
 * no dejen 9 fotos cuando el tope es 8.
 */
export function checkProductImageUpload(
  bytes: Uint8Array,
  existingCount: number
): { image: SniffedImage } | { rejection: ProductImageRejection } {
  const limit = maxImageBytes();
  if (bytes.length === 0) {
    return { rejection: { code: "not_an_image", message: "El archivo está vacío." } };
  }
  if (bytes.length > limit) {
    return {
      rejection: {
        code: "too_large",
        message: `La imagen no puede superar los ${Math.round(limit / 1024 / 1024)} MB.`,
      },
    };
  }
  const image = sniffProductImage(bytes);
  if (!image) {
    return {
      rejection: {
        code: "not_an_image",
        message: "Solo se aceptan JPG, PNG, WEBP o GIF. El archivo no es ninguna de esas cosas.",
      },
    };
  }
  const max = maxImagesPerProduct();
  if (existingCount >= max) {
    return {
      rejection: {
        code: "limit_reached",
        message: `Este producto ya tiene ${max} fotos, que es el máximo. Quita una para añadir otra.`,
      },
    };
  }
  return { image };
}

/** El texto alternativo es opcional, pero entra en la ficha del bot: cota dura. */
export const MAX_ALT_TEXT = 255;

export function normalizeAltText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_ALT_TEXT);
  return trimmed.length > 0 ? trimmed : null;
}
