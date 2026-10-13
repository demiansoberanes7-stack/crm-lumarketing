-- 0053 — Inventario y URL de sitio del catálogo
--
-- stock: piezas disponibles. NULL = sin control de inventario (el CRM muestra
-- "consultar"); 0 = agotado. website_url: URL pública del producto.

ALTER TABLE "catalog_product"
  ADD COLUMN IF NOT EXISTS "website_url" varchar(1024);

ALTER TABLE "catalog_product"
  ADD COLUMN IF NOT EXISTS "stock" integer;
