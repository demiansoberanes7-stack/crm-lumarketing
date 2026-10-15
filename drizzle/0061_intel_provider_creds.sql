-- Inteligencia: credenciales independientes SerpApi + Apify (sin depender de YouTube)
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "serpapi_key_cipher" text;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "serpapi_key_iv" text;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "serpapi_key_tag" text;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "serpapi_status" varchar(20);
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "serpapi_last_test_at" timestamp;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "serpapi_last_sync_at" timestamp;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "serpapi_queries_used" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "apify_token_cipher" text;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "apify_token_iv" text;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "apify_token_tag" text;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "apify_actor_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "apify_status" varchar(20);
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "apify_last_test_at" timestamp;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "apify_last_sync_at" timestamp;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD COLUMN IF NOT EXISTS "apify_queries_used" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Hacer que youtube_key_* sea opcional (antes NOT NULL): las nuevas orgs pueden configurar solo SerpApi/Apify/INEGI
ALTER TABLE "intel_credentials" ALTER COLUMN "youtube_key_cipher" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ALTER COLUMN "youtube_key_iv" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "intel_credentials" ALTER COLUMN "youtube_key_tag" DROP NOT NULL;
