import { z } from "zod";
import { productStockSchema, productWebsiteUrlSchema } from "@/lib/catalog-schema";
import {
  createCatalogProduct,
  getCatalogProduct,
  listCatalogProducts,
  updateCatalogProduct,
} from "@/server/catalog/service";
import { defineAction } from "@/server/mcp/registry";

/** Forma cruda reutilizable por la futura herramienta nativa de catálogo. */
export const catalogCreateShape = {
  name: z.string().min(1).max(255),
  shortDescription: z.string().max(500).nullable().optional(),
  websiteUrl: productWebsiteUrlSchema.nullable().optional(),
  stock: productStockSchema.optional(),
  price: z.number().int().min(0),
  currency: z.string().length(3).optional(),
};

const catalogCreate = z.object(catalogCreateShape);

const catalogUpdate = z
  .object({
    productId: z.string().min(1).max(255),
    name: z.string().min(1).max(255).optional(),
    shortDescription: z.string().max(500).nullable().optional(),
    websiteUrl: productWebsiteUrlSchema.nullable().optional(),
    stock: productStockSchema.optional(),
    price: z.number().int().min(0).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.shortDescription !== undefined ||
      value.websiteUrl !== undefined ||
      value.stock !== undefined ||
      value.price !== undefined,
    { message: "Al menos un campo es obligatorio" }
  );

const catalogList = z.object({
  query: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const catalogGet = z.object({ productId: z.string().min(1).max(255) });

export const catalogActions = [
  defineAction({
    name: "catalog.list",
    domain: "catalog",
    kind: "read",
    scope: "crm.catalog.read",
    title: "Listar productos del catálogo",
    description: "Lista productos del catálogo con búsqueda por nombre y límite.",
    input: catalogList,
    handler: async (principal, input) => {
      const products = await listCatalogProducts(principal.organizationId, {
        query: input.query,
        limit: input.limit,
      });
      return {
        text: `Se encontraron ${products.length} productos.`,
        structuredContent: { count: products.length, products },
      };
    },
  }),

  defineAction({
    name: "catalog.get",
    domain: "catalog",
    kind: "read",
    scope: "crm.catalog.read",
    title: "Obtener producto del catálogo",
    description: "Devuelve un producto del catálogo por ID (precio, stock y URL).",
    input: catalogGet,
    handler: async (principal, input) => {
      const product = await getCatalogProduct(principal.organizationId, input.productId);
      if (!product) throw new Error("Producto no encontrado");
      return {
        text: product.name,
        structuredContent: { product },
      };
    },
  }),

  defineAction({
    name: "catalog.create",
    domain: "catalog",
    kind: "write",
    scope: "crm.catalog.write",
    title: "Crear producto en el catálogo",
    description:
      "Agrega un producto al catálogo con precio en centavos, stock opcional (null = sin control) y URL del sitio.",
    input: catalogCreate,
    handler: async (principal, input) => {
      const { id } = await createCatalogProduct({
        organizationId: principal.organizationId,
        ...input,
      });
      return {
        text: `Producto ${input.name} creado en el catálogo.`,
        structuredContent: { productId: id },
      };
    },
  }),

  defineAction({
    name: "catalog.update",
    domain: "catalog",
    kind: "write",
    scope: "crm.catalog.write",
    title: "Actualizar producto del catálogo",
    description: "Actualiza nombre, descripción, URL, stock o precio de un producto existente.",
    input: catalogUpdate,
    handler: async (principal, input) => {
      const { productId, ...patch } = input;
      const result = await updateCatalogProduct({
        organizationId: principal.organizationId,
        productId,
        ...patch,
      });
      if (!result.ok) throw new Error(result.message);
      return {
        text: `Producto ${productId} actualizado.`,
        structuredContent: { productId },
      };
    },
  }),
];
