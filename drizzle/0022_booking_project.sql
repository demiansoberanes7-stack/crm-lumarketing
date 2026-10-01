-- 0022 — La agenda guarda a qué proyecto pertenece cada cita (booking.project_id
-- ya estaba en el schema desde 0016, pero la tabla se creó sin la columna: toda
-- reserva devolvía 500 al insertar). Se añade la columna y su índice.
ALTER TABLE "booking" ADD COLUMN IF NOT EXISTS "project_id" varchar(255);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_project_id_project_id_fk'
  ) THEN
    ALTER TABLE "booking"
      ADD CONSTRAINT "booking_project_id_project_id_fk"
      FOREIGN KEY ("project_id") REFERENCES "public"."project"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "booking_project_idx" ON "booking" USING btree ("project_id");
