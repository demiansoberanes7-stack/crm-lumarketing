import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Que la receta de costos ESTÉ, y que no tenga una segunda fórmula.
 *
 * El módulo se puede calcular perfecto y no verse en ninguna parte: el bloque
 * vive dentro de un modal que se abre desde un botón, así que un `<ProductCosts>`
 * sin montar, o montado sin `productId`, es invisible hasta que alguien lo nota
 * en producción. Lo mismo pasa con las matemáticas: si la rejilla volviera a
 * hacer su propia resta y su propia división, la tarjeta y la receta podrían
 * decir margenes distintos del mismo producto.
 *
 * Sin biblioteca de renderizado en el repo, la forma barata de fijarlo es leer
 * el fuente. No prueba el píxel; prueba el cableado.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const leer = (...rel: string[]) => readFileSync(path.join(RAIZ, ...rel), "utf8");

const cliente = leer("src", "components", "catalog", "catalog-client.tsx");
const receta = leer("src", "components", "catalog", "product-costs.tsx");
const listaRoute = leer("src", "app", "api", "catalog", "route.ts");
const servicio = leer("src", "server", "catalog", "costs.ts");

describe("Inventario: la receta montada", () => {
  it("el modal de producto monta el bloque de costos", () => {
    expect(cliente).toContain('import { ProductCosts } from "@/components/catalog/product-costs"');
    expect(cliente).toMatch(/<ProductCosts\b[\s\S]*?productId=\{editingId\}/);
  });

  it("le pasa el precio del formulario, no el guardado, para el margen en vivo", () => {
    expect(cliente).toMatch(/<ProductCosts[\s\S]*?priceCents=\{priceCentsOf\(form\.price\)\}/);
    expect(cliente).toContain("function priceCentsOf(value: string): number");
  });

  it("la tarjeta consume costSummary y lo declara en el tipo", () => {
    expect(cliente).toContain("costSummary: { totalCostCents: number; lineCount: number } | null");
    expect(cliente).toContain("p.costSummary");
  });

  it("la tarjeta y la receta calculan el margen con la MISMA función", () => {
    expect(cliente).toContain('import { marginOf } from "@/lib/catalog/cost"');
    expect(cliente).toMatch(/marginOf\(p\.price, p\.costSummary\.totalCostCents\)/);
    // Ninguna de las dos mitades vuelve a inventarse la división del margen.
    expect(cliente).not.toMatch(/marginPct\s*=\s*\(/);
    expect(receta).not.toMatch(/marginPct\s*=\s*\(/);
  });

  it("sin receta no se pinta un costo $0", () => {
    // El render va condicionado a que costSummary exista.
    expect(cliente).toMatch(/\{p\.costSummary && /);
  });
});

describe("Bloque de receta", () => {
  it("usa la matemática compartida en vez de duplicarla", () => {
    expect(receta).toContain("computeProductCost");
    expect(receta).not.toMatch(/function (compute|margin)/);
  });

  it("habla con la ruta de costos: lectura y reemplazo", () => {
    expect(receta).toContain("fetch(`/api/catalog/${productId}/costs`)");
    expect(receta).toContain('method: "PUT"');
  });

  it("distingue «no se pudo leer» de «sin insumos»", () => {
    expect(receta).toContain("No se pudo leer la receta");
    expect(receta).toContain("Sin insumos todavía");
    expect(receta).toContain("if (!productId)");
  });

  it("avisa que Rentabilidad sigue usando el costo plano", () => {
    expect(receta).toContain("flatCostCents");
    expect(receta).toContain("Rentabilidad sigue usando el costo plano");
  });

  it("explica los dos porcentajes y cuándo el de mezcla no aplica", () => {
    expect(receta).toContain("el de la mezcla");
    expect(receta).toContain("mixComparable");
  });
});

describe("Alimentación de la rejilla", () => {
  it("la lista adjunta el resumen de costo en una sola pasada", () => {
    expect(listaRoute).toContain("costSummariesByProducts");
    expect(listaRoute).toContain("costSummary: costs[p.id] ?? null");
  });

  it("el agregado se hace en SQL, no fila por fila en JS", () => {
    expect(servicio).toMatch(/sum\(round\(/);
    expect(servicio).toContain("groupBy");
  });
});
