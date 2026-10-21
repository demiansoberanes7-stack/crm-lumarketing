import { describe, expect, it } from "vitest";
import { intParam } from "@/lib/api";

/**
 * El bug que estas pruebas cierran: cuatro rutas de listado hacían
 * `parseInt(url.searchParams.get("limit") ?? "50")` sin respaldo. Con
 * `?limit=abc` el resultado es `NaN`, Drizzle manda `LIMIT NaN`, Postgres
 * rechaza la consulta y `withAuth` responde 500 — que la pantalla del dueño
 * leía como «no hay datos».
 */
const url = (query: string) => new URL(`http://local/api/x${query}`);

describe("intParam", () => {
  it("usa el valor de la consulta cuando es un entero válido", () => {
    expect(intParam(url("?limit=25"), "limit", { fallback: 50, max: 100 })).toBe(25);
  });

  it("cae en el respaldo si el param falta o viene vacío", () => {
    expect(intParam(url(""), "limit", { fallback: 50, max: 100 })).toBe(50);
    expect(intParam(url("?limit="), "limit", { fallback: 50, max: 100 })).toBe(50);
    expect(intParam(url("?limit=%20"), "limit", { fallback: 50, max: 100 })).toBe(50);
  });

  it("jamás devuelve NaN: la basura y los prefijos no numéricos usan el respaldo", () => {
    expect(intParam(url("?limit=abc"), "limit", { fallback: 50, max: 100 })).toBe(50);
    expect(intParam(url("?limit=%20abc"), "limit", { fallback: 50, max: 100 })).toBe(50);
    expect(intParam(url("?limit=Infinity"), "limit", { fallback: 50, max: 100 })).toBe(50);
  });

  it("acota al rango: arriba por max y abajo por min", () => {
    expect(intParam(url("?limit=9999"), "limit", { fallback: 50, max: 100 })).toBe(100);
    expect(intParam(url("?limit=-5"), "limit", { fallback: 50, max: 100 })).toBe(0);
    expect(intParam(url("?limit=0"), "limit", { fallback: 100, min: 1, max: 500 })).toBe(1);
    expect(intParam(url("?limit=-5"), "limit", { fallback: 100, min: 1, max: 500 })).toBe(1);
  });

  it("sin max solo acota por abajo, para que offset no se vuelva negativo", () => {
    expect(intParam(url("?offset=-40"), "offset", { fallback: 0 })).toBe(0);
    expect(intParam(url("?offset=12000"), "offset", { fallback: 0 })).toBe(12000);
  });

  it("trunca decimales en vez de fallar", () => {
    expect(intParam(url("?limit=49.9"), "limit", { fallback: 50, max: 100 })).toBe(49);
  });

  it("respeta un 0 explícito cuando min lo permite", () => {
    expect(intParam(url("?offset=0"), "offset", { fallback: 20 })).toBe(0);
  });
});
