import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El nombre del módulo tiene que leerse siempre.
 *
 * Dos invariantes de CSS se comían el globo en escritorio, y un cambio en un
 * archivo ajeno puede volver a romper cualquiera de las dos:
 *
 * 1. El `nav` es la única región con scroll del rail (ventanas cortas). Un
 *    contenedor de scroll recorta lo que asoma por su derecha, así que el
 *    globo no puede ser hijo del enlace: es hijo del `<aside>`.
 * 2. `lg:translate-x-0` del `<aside>` no es adorno: un `transform` convierte
 *    al elemento en contexto de apilamiento, y su `z-50` interno deja de valer
 *    afuera. Sin z-index propio, el rail compite con 0 contra la cabecera
 *    (`sticky z-30`, que viene después en el DOM) y el globo sale pintado por
 *    detrás.
 *
 * El número del rail debe quedar por encima de la cabecera y por debajo de los
 * diálogos de página (`z-50`) y del ⌘K (`z-[70]`), que sí deben tapar el menú.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const leer = (...rel: string[]) => readFileSync(path.join(RAIZ, ...rel), "utf8");

const nav = leer("src", "components", "app-nav.tsx");
const cabecera = leer("src", "components", "app-header.tsx");

/** Las dos cadenas de clases del `<aside>` (base + variante de escritorio). */
function clasesDelRail(): string {
  const aside = /<aside[\s\S]*?className=\{cn\(\s*"([^"]*)",\s*"([^"]*)"/.exec(nav);
  const clases = `${aside?.[1] ?? ""} ${aside?.[2] ?? ""}`;
  expect(clases.trim(), "la firma del <aside> cambió y este test dejó de anclar").not.toBe("");
  return clases;
}

/** El `z-` declarado en la etiqueta `<header>`. */
function zDeLaCabecera(): number {
  const header = /<header[^>]*className="([^"]*)"/.exec(cabecera);
  const clases = header?.[1] ?? "";
  expect(clases, "la cabecera cambió de forma y este test dejó de anclar").not.toBe("");
  const z = /z-(\d+)/.exec(clases);
  expect(z, "la cabecera ya no declara su z-index").not.toBeNull();
  return Number(z?.[1] ?? 0);
}

describe("capas del rail lateral", () => {
  it("el rail de escritorio declara un z-index numérico, nunca auto", () => {
    const clases = clasesDelRail();
    expect(clases).toMatch(/lg:z-\d+/);
    expect(clases).not.toMatch(/lg:z-auto/);
  });

  it("queda por encima de la cabecera y por debajo de los diálogos", () => {
    const rail = Number(/lg:z-(\d+)/.exec(clasesDelRail())?.[1] ?? 0);
    expect(rail).toBeGreaterThan(zDeLaCabecera());
    // 50 = diálogos de página, 70 = ⌘K. Un rail por encima taparía un diálogo
    // abierto: es el error inverso y también tiene que fallar.
    expect(rail).toBeLessThan(50);
  });

  it("el globo sigue anclado a un aside relativo y sin recorte", () => {
    const clases = clasesDelRail();
    expect(clases).toContain("lg:relative");
    expect(clases).toContain("lg:overflow-visible");
    // `lg:translate-x-0` es justamente lo que crea el contexto de apilamiento.
    expect(clases).toContain("lg:translate-x-0");
    expect(nav).toMatch(/role="tooltip"[\s\S]{0,200}?z-50/);
  });

  it("el globo se renderiza dentro del aside, no dentro del enlace", () => {
    // Hijo del enlace = hijo de la región con scroll = recortado en ventanas
    // cortas. El globo se monta al final del `<aside>`, después de la versión.
    const version = nav.indexOf("versionLabel(sha)");
    const tooltip = nav.indexOf('role="tooltip"');
    expect(version).toBeGreaterThan(-1);
    expect(tooltip).toBeGreaterThan(version);
    expect(nav.slice(tooltip)).toContain("</aside>");
  });
});
