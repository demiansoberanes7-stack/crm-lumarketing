ALTER TABLE "intel_video" ADD COLUMN IF NOT EXISTS "duration_seconds" integer;
--> statement-breakpoint
ALTER TABLE "intel_video" ADD COLUMN IF NOT EXISTS "published_at" timestamp;
--> statement-breakpoint
ALTER TABLE "intel_video" ADD COLUMN IF NOT EXISTS "channel_title" varchar(200);
