-- Auditoría durable de acciones del operador sobre otros negocios de la
-- instancia (cambio de contraseña, borrado). Sin claves foráneas a propósito:
-- la fila debe sobrevivir al borrado del negocio o de la cuenta afectada.
-- Aditiva y re-ejecutable.

CREATE TABLE IF NOT EXISTS "instance_admin_audit" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "actor_user_id" varchar(255) NOT NULL,
  "actor_email" varchar(255) NOT NULL,
  "action" varchar(64) NOT NULL,
  "target_organization_id" varchar(255),
  "target_organization_name" varchar(255),
  "target_user_id" varchar(255),
  "target_user_email" varchar(255),
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "instance_admin_audit_created_idx" ON "instance_admin_audit" USING btree ("created_at");
