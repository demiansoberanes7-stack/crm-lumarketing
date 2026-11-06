import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");

function fuente(relativo: string): string {
  return readFileSync(path.join(RAIZ, relativo), "utf8");
}

/**
 * El driver postgres-js de Drizzle reemplaza los serializadores de fecha por
 * `val => val`, así que un `Date` interpolado en `sql` (sin columna que lo
 * codifique) llega crudo a Bind y revienta con ERR_INVALID_ARG_TYPE. Los
 * operadores tipados (`gte`, `lt`) sí lo codifican; las plantillas, no.
 *
 * Esta prueba ancla los filtros de solape y de ventana que ya se rompieron en
 * producción, para que nadie los devuelva a `Date` crudo.
 */
const FILTROS: Array<[string, string]> = [
  [
    "src/server/agenda/queries.ts",
    "${opts.fromUtc.toISOString()}::timestamptz",
  ],
  [
    "src/server/agenda/availability.ts",
    "${input.fromUtc.toISOString()}::timestamptz",
  ],
  [
    "src/server/agenda/availability.ts",
    "${input.startUtc.toISOString()}::timestamptz",
  ],
  [
    "src/server/dashboard/ops.ts",
    "${since24hIso}::timestamptz",
  ],
];

describe("parámetros de fecha en plantillas SQL", () => {
  it.each(FILTROS)("%s usa ISO con cast (%s)", (archivo, fragmento) => {
    expect(fuente(archivo)).toContain(fragmento);
  });

  it.each([
    ["src/server/agenda/queries.ts", "${opts.fromUtc}"],
    ["src/server/agenda/availability.ts", "${input.fromUtc}"],
    ["src/server/agenda/availability.ts", "${input.startUtc}"],
    ["src/server/dashboard/ops.ts", "${since24h}"],
  ])("%s no interpola %s crudo", (archivo, crudo) => {
    expect(fuente(archivo)).not.toContain(crudo);
  });
});
