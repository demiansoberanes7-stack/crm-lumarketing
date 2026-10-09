-- Contacto: medio por el que se contactó primero
-- (red social + cuál, llamada, correo, presencial; catálogo en src/lib/contact-medium.ts)
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "medium" varchar(30);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "medium_detail" varchar(60);
