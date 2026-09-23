ALTER TABLE caltodo_task ADD COLUMN project_id varchar(255) REFERENCES project(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX caltodo_task_project_idx ON caltodo_task(project_id);
