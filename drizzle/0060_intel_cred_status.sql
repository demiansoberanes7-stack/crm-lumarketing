ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "denue_last_test_at" timestamp;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "denue_status" varchar(20);
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "youtube_last_test_at" timestamp;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "youtube_status" varchar(20);
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "gt_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "gt_last_sync_at" timestamp;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "gt_status" varchar(20);
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "gt_last_test_at" timestamp;
