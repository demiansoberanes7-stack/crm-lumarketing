import { z } from "zod";

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
