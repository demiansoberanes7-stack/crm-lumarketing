-- Watsi — copiloto interno de métricas
CREATE TABLE IF NOT EXISTS "watsi_conversation" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" varchar(255) NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "title" varchar(255) NOT NULL DEFAULT 'Nueva conversación',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "watsi_conversation_org_user_idx" ON "watsi_conversation" ("organization_id", "user_id", "updated_at");

CREATE TABLE IF NOT EXISTS "watsi_message" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "conversation_id" varchar(255) NOT NULL REFERENCES "watsi_conversation"("id") ON DELETE CASCADE,
  "role" varchar(20) NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "watsi_message_conversation_idx" ON "watsi_message" ("conversation_id", "created_at");
