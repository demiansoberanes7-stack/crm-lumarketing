-- 0083 — Descartar prospectos
--
-- prospect_dismissal: la marca de «esta persona ya no me interesa en la lista de
-- Prospectos». La pantalla es una vista sobre los mensajes entrantes, no una
-- tabla, así que no había fila que marcar — y en el correo tampoco había
-- contacto (su `contact_id` queda en NULL), así que ni siquiera existía un
-- `archived_at` donde apoyarse.
--
-- Sin FK hacia contacto ni hacia user a propósito: una cascada borraría el
-- descarte cuando se va el contacto o el miembro, y la persona descartada
-- reaparecería en la lista. La FK a organization sí va en cascada porque al
-- cerrar un negocio sus marcas dejan de tener dueño.
--
-- Aditiva y re-ejecutable.

CREATE TABLE IF NOT EXISTS "prospect_dismissal" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "kind" varchar(16) NOT NULL,
  "key" varchar(320) NOT NULL,
  "dismissed_by" varchar(255),
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospect_dismissal" ADD CONSTRAINT "prospect_dismissal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospect_dismissal" ADD CONSTRAINT "prospect_dismissal_kind_check" CHECK ("kind" IN ('contact','email'));
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prospect_dismissal_org_kind_key_uq" ON "prospect_dismissal" ("organization_id","kind","key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospect_dismissal_org_kind_idx" ON "prospect_dismissal" ("organization_id","kind");
