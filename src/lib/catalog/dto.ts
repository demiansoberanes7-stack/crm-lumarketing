/**
 * Forma que viaja al navegador para cada foto del catálogo.
 *
 * Módulo aparte y sin dependencias de servidor porque lo consume el cliente:
 * `src/lib/product-images.ts` valida bytes y lee el entorno, y arrastrar eso al
 * bundle del navegador por culpa de un `type` no tiene sentido. Es el mismo
 * criterio que `src/lib/agenda/dto.ts`: un solo dueño del contrato, así que
 * renombrar un campo rompe la compilación en vez de pintar `undefined`.
 */
export type ProductImageDto = {
  id: string;
  productId: string;
  /** URL servida por `/api/media/public/[orgId]/catalog/…`. */
  url: string;
  mimeType: string;
  bytes: number;
  /** null cuando la cabecera del formato no se pudo leer al subir. */
  width: number | null;
  height: number | null;
  altText: string | null;
  position: number;
  isPrimary: boolean;
};
