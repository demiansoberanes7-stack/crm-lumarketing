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
  return postgres(env.DATABASE_URL);
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
