-- 0082 — Teléfono del cliente en la cotización
--
-- `client_phone` es el número que se imprime en "COTIZADO PARA". Vive en la
-- cotización y no solo en el contacto porque se cotiza también a clientes sin
-- ficha (o con otro número) y el PDF necesita el que escribió el operador.
--
-- Aditiva y re-ejecutable.

ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "client_phone" varchar(32);
