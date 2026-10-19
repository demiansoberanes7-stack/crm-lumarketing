/**
 * CLI del seed demo: `pnpm seed:demo` (local) o `node seed-demo.mjs` dentro
 * del contenedor. Acepta --force para recarga aunque haya datos.
 * Se bundlea con esbuild (alias @ → ./src).
 */
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { seedDemo, isDomainEmpty } from "@/server/seed/demo";

function loadEnvVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[seed] DATABASE_URL no está definida");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
const db = drizzle(sql, { schema });

// Con varios negocios en la instancia, «la primera organización» ya no es una
// elección inofensiva: el seed escribiría leads y conversaciones falsos dentro
// del CRM de un cliente. Se exige --org=<id> salvo que haya exactamente una.
const requestedOrg = process.argv
  .find((arg) => arg.startsWith("--org="))
  ?.slice("--org=".length);

const orgs = await db
  .select({ id: schema.organization.id, name: schema.organization.name })
  .from(schema.organization)
  .orderBy(schema.organization.createdAt);

if (orgs.length === 0) {
  console.error(
    "[seed] No hay organización: regístrate primero en la app y vuelve a correr el seed"
  );
  await sql.end();
  process.exit(1);
}

const org = requestedOrg
  ? orgs.find((row) => row.id === requestedOrg)
  : orgs.length === 1
    ? orgs[0]
    : undefined;

if (!org) {
  console.error(
    requestedOrg
      ? `[seed] No existe la organización «${requestedOrg}»`
      : `[seed] Hay ${orgs.length} negocios; indica cuál con --org=<id> para no sembrar datos de prueba en el CRM de un cliente`
  );
  await sql.end();
  process.exit(1);
}

const force = process.argv.includes("--force");
if (!force && !(await isDomainEmpty(db, org.id))) {
  console.error(
    "[seed] La organización ya tiene datos. Usa --force para recargar la demo."
  );
  await sql.end();
  process.exit(1);
}

const result = await seedDemo(db, org.id);
console.log(
  `[seed] Ferretería El Martillo cargada: ${result.contacts} contactos, ${result.kbEntries} entradas de KB, 1 corrida de ejemplo`
);
await sql.end();
process.exit(0);
