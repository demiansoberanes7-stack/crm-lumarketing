-- Multi-oportunidad y atribución (P3/P6).
--
-- 1) Se levanta el índice único que impedía abrir una SEGUNDA oportunidad para
--    el mismo contacto (decisión de producto: varias oportunidades por
--    contacto, con `lead.is_primary` marcando la que usan las rutas 1:1).
--    No toca filas: solo deja de vigilar una restricción.
-- 2) A cambio, el primer toque de atribución queda protegido por su índice
--    único PARCIAL (una sola vez por contacto).
-- 3) Índice simple de apoyo para buscar los leads de un contacto.

DROP INDEX IF EXISTS "lead_contact_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attribution_event_first_uq" ON "attribution_event" ("organization_id","contact_id") WHERE "touch_type" = 'first';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_contact_idx" ON "lead" ("contact_id");
