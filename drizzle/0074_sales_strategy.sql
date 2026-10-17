-- Fase H — Estrategias de ventas.
-- Tabla para almacenar estrategias de ventas vinculadas a ofertas, experimentos
-- o campañas, con objetivos de ingresos y conversiones.
-- Aditiva: no rompe filas existentes.

CREATE TABLE "strategy" (
  "id" varchar(255) NOT NULL PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "description" text,
  "object_type" varchar(20) NOT NULL,
  "object_id" varchar(255) NOT NULL,
  "acquisition_channel_id" varchar(255) REFERENCES "acquisition_channel" ("id") ON DELETE SET NULL,
  "revenue_target_cents" integer,
  "conversion_target" integer,
  "status" varchar(30) NOT NULL DEFAULT 'active',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Índices de consulta habituales.
CREATE INDEX "strategy_org_idx" ON "strategy" ("organization_id");
CREATE INDEX "strategy_object_idx" ON "strategy" ("object_type", "object_id");
CREATE INDEX "strategy_channel_idx" ON "strategy" ("acquisition_channel_id");
