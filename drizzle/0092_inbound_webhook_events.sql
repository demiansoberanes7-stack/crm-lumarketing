-- 0092 — bandeja durable de webhooks autenticados
--
-- Cada fila contiene un subevento de un solo tenant. `locked_until` es una
-- lease recuperable: el estado público sigue siendo pending/processed/failed.

CREATE TABLE IF NOT EXISTS "inbound_webhook_event" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "provider" varchar(40) NOT NULL,
  "idempotency_key" varchar(64) NOT NULL,
  "event_type" varchar(80) NOT NULL,
  "raw_body" text,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "run_at" timestamp NOT NULL DEFAULT now(),
  "locked_until" timestamp,
  "lock_token" varchar(255),
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "received_at" timestamp NOT NULL DEFAULT now(),
  "processed_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inbound_webhook_event"
    ADD CONSTRAINT "inbound_webhook_event_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_webhook_event_org_provider_key_uq"
  ON "inbound_webhook_event" ("organization_id", "provider", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_webhook_event_due_idx"
  ON "inbound_webhook_event" ("status", "run_at", "locked_until");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_webhook_event_org_received_idx"
  ON "inbound_webhook_event" ("organization_id", "received_at");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inbound_webhook_event"
    ADD CONSTRAINT "inbound_webhook_event_status_check"
    CHECK ("status" IN ('pending', 'processed', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
