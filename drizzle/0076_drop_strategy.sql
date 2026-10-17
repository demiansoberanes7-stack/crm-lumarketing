-- Retira el módulo de Estrategias de Venta: se elimina la tabla (y con ella
-- sus datos) porque la sección se quitó del CRM por completo.
-- IF EXISTS + sin dependencias externas: re-ejecutable en cualquier entorno.
DROP TABLE IF EXISTS "strategy";
