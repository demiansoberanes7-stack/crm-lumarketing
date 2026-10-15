CREATE TABLE IF NOT EXISTS "rate_limit_bucket" (
  "key" varchar(255) PRIMARY KEY NOT NULL,
  "window_started_at" timestamp NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS "rate_limit_bucket_expires_idx"
  ON "rate_limit_bucket" ("expires_at");

--> statement-breakpoint
DELETE FROM "rate_limit_bucket"
WHERE "expires_at" < NOW();
