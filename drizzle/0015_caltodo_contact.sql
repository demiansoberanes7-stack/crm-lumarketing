ALTER TABLE "caltodo_task" ADD COLUMN "contact_id" varchar(255);--> statement-breakpoint
ALTER TABLE "caltodo_task" ADD CONSTRAINT "caltodo_task_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "caltodo_task_contact_idx" ON "caltodo_task" ("contact_id");