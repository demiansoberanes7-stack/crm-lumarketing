-- Mark stale running runs as failed before adding the unique index
UPDATE agent_test_run SET status = 'failed', error = 'Interrumpido por restart', finished_at = now() WHERE status = 'running';
--> statement-breakpoint
-- Partial unique index: at most one running run per organization
CREATE UNIQUE INDEX IF NOT EXISTS one_running_run_per_org ON agent_test_run(organization_id) WHERE status = 'running';
