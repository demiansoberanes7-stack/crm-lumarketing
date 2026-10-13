import { z } from "zod";

export const productImageUrlSchema = z.string().max(1024).refine((value) => {
  if (value.startsWith("/api/media/public/")) {
    return /^\/api\/media\/public\/[\w-]{1,64}\/catalog\/[\w.-]{1,128}$/.test(value);
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}, "Debe ser una URL HTTP(S) o una imagen cargada al catálogo");

/** URL del sitio web del producto (tienda, marketplace, landing). */
export const productWebsiteUrlSchema = z
  .string()
  .max(1024)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "Debe ser una URL HTTP(S)");

/**
 * Piezas en inventario. null = sin control de inventario (el CRM muestra
 * "consultar"); 0 = agotado.
 */
export const productStockSchema = z.number().int().min(0).max(1_000_000).nullable();
