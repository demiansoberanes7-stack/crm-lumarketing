-- 0049 — Comentarios públicos de publicaciones (canal comments).
--
-- Sincroniza los comentarios de las publicaciones de Instagram y de la página
-- de Facebook hacia la Bandeja como un canal propio. Cada comentario es un
-- mensaje entrante en la hebra del autor sobre ese post. `external_comment_id`
-- es la llave de idempotencia del poller (mismo criterio que review_name en
-- Google Business).

CREATE TABLE IF NOT EXISTS "social_comment" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"platform" varchar(20) NOT NULL,
	"external_comment_id" varchar(255) NOT NULL,
	"post_external_id" varchar(255) NOT NULL,
	"post_caption" varchar(500),
	"author_external_id" varchar(255) NOT NULL,
	"author_name" varchar(255),
	"body" text NOT NULL,
	"parent_external_id" varchar(255),
	"comment_time" timestamp NOT NULL,
	"reply_text" text,
	"replied_at" timestamp,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "social_comment_org_ext_uq" UNIQUE("organization_id","external_comment_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_comment_org_platform_post_idx" ON "social_comment" ("organization_id","platform","post_external_id");
--> statement-breakpoint
ALTER TABLE "social_comment" ADD CONSTRAINT "social_comment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
