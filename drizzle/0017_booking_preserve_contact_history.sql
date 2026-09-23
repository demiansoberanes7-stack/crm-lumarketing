-- Align the installed FK with schema.ts without deleting booking history.
ALTER TABLE "booking" DROP CONSTRAINT IF EXISTS "booking_contact_id_contact_id_fk";
--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_contact_id_contact_id_fk"
  FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
