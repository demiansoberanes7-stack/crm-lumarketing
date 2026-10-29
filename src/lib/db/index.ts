import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Cliente de BD único por proceso. En dev, Next recarga módulos: se cachea en
 * globalThis para no agotar conexiones.
 */
const globalForDb = globalThis as unknown as {
  __zorroSql?: postgres.Sql;
};

function createClient() {
  const env = getEnv();
  // El pooler de Supabase (modo sesión) corta en 15 clientes por proyecto y el
  // default de postgres.js es 10 por proceso, así que una pestaña con varios
  // paneles abiertos y los pollers en vuelo agotaban el cupo: la API devolvía
  // 500 con (EMAXCONNSESSION) sin que nada estuviera realmente roto. Con 5
  // quedan conexiones para una segunda instancia y para el operador.
  // `idle_timeout` corto devuelve al pooler las que quedan ociosas entre
  // navegaciones, en vez de retenerlas hasta que expira la sesión.
  return postgres(env.DATABASE_URL, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

export function getSql() {
  if (!globalForDb.__zorroSql) globalForDb.__zorroSql = createClient();
  return globalForDb.__zorroSql;
}

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!cachedDb) cachedDb = drizzle(getSql(), { schema });
  return cachedDb;
}

export { schema };
