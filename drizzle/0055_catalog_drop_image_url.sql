-- 0055 — El inventario ya no guarda foto de producto
--
-- La columna image_url se eliminó del formulario (solo quedan: nombre, precio,
-- descripción corta, URL de sitio y piezas en inventario). Se borra la columna.

ALTER TABLE "catalog_product"
  DROP COLUMN IF EXISTS "image_url";
