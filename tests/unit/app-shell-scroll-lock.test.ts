import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El documento no scrollea mientras el cascarón está montado.
 *
 * El shell es `h-dvh` con scroll interno por panel. Si una caja en flujo queda
 * fuera del shell (extensiones del navegador, nodos inyectados en <body>), el
 * documento crece y la rueda, al agotar un scroller interno, arrastra el rail y
 * la cabecera fuera de pantalla sobre un vacío en blanco. El candado de <html>
 * tiene que existir y estar condicionado a la presencia del shell: en rutas
 * públicas (login, landing) la página debe seguir scrolleando.
 *
 * Se prueba sobre el código fuente porque el entorno Vitest es `node`, sin DOM.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const leer = (...rel: string[]) => readFileSync(path.join(RAIZ, ...rel), "utf8");

const shell = leer("src", "components", "app-shell.tsx");
const css = leer("src", "app", "globals.css");

/** El bloque de la regla que bloquea el documento. */
function candado(): string {
  const regla = /html:has\(\.app-shell\)\s*\{([^}]*)\}/.exec(css);
  expect(regla, "falta la regla html:has(.app-shell) en globals.css").not.toBeNull();
  return regla?.[1] ?? "";
}

describe("candado de scroll del cascarón", () => {
  it("el shell lleva la clase marcadora que activa el candado", () => {
    const raiz = /<div\s+className="([^"]*h-dvh[^"]*)"/.exec(shell);
    expect(raiz, "la raíz del shell cambió de forma y este test dejó de anclar").not.toBeNull();
    expect(raiz?.[1]).toMatch(/\bapp-shell\b/);
  });

  it("con el shell montado, <html> no scrollea ni encadena la rueda", () => {
    const bloque = candado();
    expect(bloque).toMatch(/overflow:\s*hidden/);
    expect(bloque).toMatch(/overscroll-behavior:\s*none/);
  });

  it("el candado no es global: está condicionado a :has(.app-shell)", () => {
    // Un `html { overflow: hidden }` suelto dejaría sin scroll al login y a la
    // landing. Toda regla de <html> con overflow hidden debe ser condicionada.
    const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const reglasHtml = [...sinComentarios.matchAll(/(?:^|\})\s*(html[^{}]*?)\s*\{([^}]*)\}/g)];
    const bloqueadas = reglasHtml.filter((m) => /overflow:\s*hidden/.test(m[2] ?? ""));
    expect(bloqueadas.length, "no hay ninguna regla de <html> con overflow hidden").toBeGreaterThan(0);
    for (const regla of bloqueadas) {
      expect(regla[1]?.trim()).toContain(":has(.app-shell)");
    }
  });
});
