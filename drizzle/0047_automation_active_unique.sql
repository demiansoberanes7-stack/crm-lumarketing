-- 0047 — Cierre de carrera en el dedup de automatizaciones.
--
-- enqueueFollowUp hacía SELECT-then-INSERT: dos eventos simultáneos (o dos
-- procesos) pasaban la revisión de dedup y colaban el mismo seguimiento dos
-- veces. El índice único parcial lo cierra en la propia BD: una sola
-- ejecución activa (queued/running) por regla y conversación.
--
-- Antes del índice se cancelan los duplicados activos que ya existan,
-- conservando la ejecución más antigua de cada grupo.

UPDATE "automation_execution" a
SET
  "status" = 'cancelled',
  "error" = 'duplicado cancelado antes del índice único automation_execution_active_uq',
  "updated_at" = now()
WHERE a."status" IN ('queued', 'running')
  AND a."id" NOT IN (
    SELECT DISTINCT ON ("organization_id", "conversation_id", "rule_id") "id"
    FROM "automation_execution"
    WHERE "status" IN ('queued', 'running')
    ORDER BY "organization_id", "conversation_id", "rule_id", "created_at" ASC
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_execution_active_uq"
ON "automation_execution" USING btree ("organization_id", "conversation_id", "rule_id")
WHERE status IN ('queued', 'running');
