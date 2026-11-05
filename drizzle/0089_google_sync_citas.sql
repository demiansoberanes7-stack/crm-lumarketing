-- 0089 — Citas con su propio evento de Google · OAuth pendiente por usuario
--
-- Bloque B (Calendario personal de Google). Las dos cosas que faltaban para
-- poder escribir en Google sin duplicar nada, y ninguna toca datos existentes:
--
-- 1. `booking.google_event_id` — NO es `external_ref`. Ese campo es la
--    referencia del CONECTOR (reunión de Zoom, evento de Meet, lo que sea que
--    devolvió quien entrega la reunión) y lo releen `refreshMeeting` y
--    `withConnector` al reintentar el enlace. El evento de calendario es otro
--    objeto: cuando el conector es Google son el mismo evento y la
--    sincronización adopta su id; con Zoom, enlace fijo o sin conector se crea
--    aparte. Mezclarlos en una columna haría imposible saber si una cita ya
--    tiene evento y permitiría ir a hacer un `PATCH` de Calendar contra un id
--    de Zoom.
-- 2. `google_oauth_state.user_id` — desde 0087 cada miembro puede conectar SU
--    calendario. El estado del flujo OAuth es de un solo uso y ~10 minutos,
--    pero se consume por organización: sin esta columna, el callback de una
--    persona podía consumir el estado que inició otra y el calendario personal
--    acababa atribuido a quien no es.
--
-- Todo nullable y aditivo: ninguna fila existente cambia de significado y el
-- código que no lee estas columnas sigue funcionando igual.

ALTER TABLE "booking" ADD COLUMN IF NOT EXISTS "google_event_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "google_oauth_state" ADD COLUMN IF NOT EXISTS "user_id" varchar(255);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "google_oauth_state" ADD CONSTRAINT "google_oauth_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
