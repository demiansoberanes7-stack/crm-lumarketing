-- 0086 — Plantillas de correo reutilizables
--
-- email_template: HTML que el negocio carga una vez y reutiliza en campañas.
-- La campaña guarda una copia del HTML (broadcast_campaign.body_html): editar o
-- borrar la plantilla después no cambia lo que ya se iba a enviar.
--
-- Aditiva y re-ejecutable.

CREATE TABLE IF NOT EXISTS "email_template" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "name" varchar(160) NOT NULL,
  "subject" varchar(300) NOT NULL,
  "html" text NOT NULL,
  "created_by" varchar(255),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_template" ADD CONSTRAINT "email_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_template" ADD CONSTRAINT "email_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_template_org_created_idx"
  ON "email_template" ("organization_id", "created_at");
--> statement-breakpoint
ALTER TABLE "broadcast_campaign" ADD COLUMN IF NOT EXISTS "body_html" text;
