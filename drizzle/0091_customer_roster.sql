-- 0091 — cartera de clientes independiente del Pipeline
--
-- Un cliente permanece en la cartera después de archivar su oportunidad. La
-- fecha es sticky: se fija al ganar una oportunidad o al darlo de alta desde
-- Clientes y no se borra al mover o archivar leads.

ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "customer_since" timestamp;
--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
--> statement-breakpoint
UPDATE "contact" AS c
SET "customer_since" = COALESCE(
  (
    SELECT min(e."occurred_at")
    FROM "lead_stage_event" AS e
    WHERE e."organization_id" = c."organization_id"
      AND e."contact_id" = c."id"
      AND e."to_stage_kind" = 'won'
  ),
  (
    SELECT min(l."created_at")
    FROM "lead" AS l
    INNER JOIN "pipeline_stage" AS s
      ON s."id" = l."stage_id"
     AND s."organization_id" = l."organization_id"
    WHERE l."organization_id" = c."organization_id"
      AND l."contact_id" = c."id"
      AND s."kind" = 'won'
  )
)
WHERE c."customer_since" IS NULL
  AND (
    EXISTS (
      SELECT 1
      FROM "lead_stage_event" AS e
      WHERE e."organization_id" = c."organization_id"
        AND e."contact_id" = c."id"
        AND e."to_stage_kind" = 'won'
    )
    OR EXISTS (
      SELECT 1
      FROM "lead" AS l
      INNER JOIN "pipeline_stage" AS s
        ON s."id" = l."stage_id"
       AND s."organization_id" = l."organization_id"
      WHERE l."organization_id" = c."organization_id"
        AND l."contact_id" = c."id"
        AND s."kind" = 'won'
    )
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_org_customer_since_idx"
  ON "contact" ("organization_id", "customer_since")
  WHERE "customer_since" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_org_active_stage_pos_idx"
  ON "lead" ("organization_id", "stage_id", "position")
  WHERE "archived_at" IS NULL;
