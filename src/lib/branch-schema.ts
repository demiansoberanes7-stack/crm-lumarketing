import { z } from "zod";

/**
 * Cantidad de un producto en una sucursal. 0 = enlazado pero agotado allí;
 * el tope es el mismo que el del stock general del catálogo.
 */
export const BRANCH_QUANTITY_MAX = 1_000_000;

export const branchQuantitySchema = z
  .number()
  .int()
  .min(0)
  .max(BRANCH_QUANTITY_MAX);
