-- 0021 — Se elimina el catálogo de plantillas de WhatsApp: sin plantillas el
-- envío proactive no existe y el CRM queda reactivo (solo responde dentro de
-- la ventana de 24 h). La tabla se va; los mensajes históricos que guardaron
-- type/origin = 'template' son texto normal y se siguen mostrando.
DROP TABLE IF EXISTS "template" CASCADE;
