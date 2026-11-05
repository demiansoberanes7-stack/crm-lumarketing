-- 0087 — Citas con motivo/ubicación/responsable · horarios y Google por usuario
--
-- Tres tablas, todo aditivo y re-ejecutable. Las columnas nuevas son NULLABLE:
-- ninguna fila existente cambia de significado y el código que no las lee sigue
-- funcionando exactamente igual.
--
-- `user_id` NULL en calendar_settings y google_credentials significa "la fila
-- del NEGOCIO", que es lo único que había antes y lo que siguen usando los
-- conectores para crear enlaces de Meet. La disponibilidad y la sincronización
-- personal caen al negocio cuando el miembro no ha configurado lo suyo, así que
-- nadie cambia de comportamiento hasta que decide cambiarlo.
--
-- Los índices únicos de antes (`calendar_settings_org_uq`,
-- `google_credentials_org_uq`, creados como UNIQUE INDEX en la 0000) se
-- sustituyen por restricciones `UNIQUE NULLS NOT DISTINCT`: en un índice único
-- ordinario los NULL no chocan entre sí y se permitirían dos filas "del
-- negocio" para el mismo org. Postgres 17 lo admite; Supabase está en 17.11.

ALTER TABLE "calendar_settings" ADD COLUMN IF NOT EXISTS "user_id" varchar(255);
--> statement-breakpoint
DROP INDEX IF EXISTS "calendar_settings_org_uq";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_settings" ADD CONSTRAINT "calendar_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_settings" ADD CONSTRAINT "calendar_settings_org_user_uq" UNIQUE NULLS NOT DISTINCT ("organization_id","user_id");
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "google_credentials" ADD COLUMN IF NOT EXISTS "user_id" varchar(255);
--> statement-breakpoint
DROP INDEX IF EXISTS "google_credentials_org_uq";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "google_credentials" ADD CONSTRAINT "google_credentials_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "google_credentials" ADD CONSTRAINT "google_credentials_org_user_uq" UNIQUE NULLS NOT DISTINCT ("organization_id","user_id");
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- `title` NULL = se muestra el nombre del contacto, como hasta hoy. `location`
-- es texto libre a propósito: una enum de modalidades obligaría a migrar cada
-- vez que alguien atienda por teléfono, en la sala de al lado o en un café.
ALTER TABLE "booking" ADD COLUMN IF NOT EXISTS "title" varchar(255);
--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN IF NOT EXISTS "location" varchar(255);
--> statement-breakpoint
-- El responsable de la cita. ON DELETE SET NULL, no CASCADE: dar de baja a un
-- miembro nunca debe borrar el historial de citas que atendió.
ALTER TABLE "booking" ADD COLUMN IF NOT EXISTS "user_id" varchar(255);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking" ADD CONSTRAINT "booking_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- La vista de calendario filtra por rango de fechas Y por estado; sin este
-- índice el planner usa el de solo fecha y ordena después.
CREATE INDEX IF NOT EXISTS "booking_org_when_status_idx" ON "booking" ("organization_id","scheduled_at","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_org_user_when_idx" ON "booking" ("organization_id","user_id","scheduled_at");
