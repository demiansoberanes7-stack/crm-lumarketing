-- Calificación de leads: criterios configurables por organización y el
-- resultado por lead (cuándo se calificó y qué criterios se cumplieron).
CREATE TABLE IF NOT EXISTS "qualification_criteria" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "definition" jsonb NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "qualification_criteria_org_uq" ON "qualification_criteria" ("organization_id");
--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "qualified_at" timestamp;
--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "qualification_data" jsonb;
