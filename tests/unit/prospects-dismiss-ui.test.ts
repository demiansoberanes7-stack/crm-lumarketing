import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La acción de descartar, anclada a la pantalla.
 *
 * El servicio y la ruta ya tienen sus pruebas; lo que aquí se cuida es que el
 * botón EXISTA y apunte al verbo correcto. Sin anclaje, un refactor del JSX se
 * llevaba la acción en silencio y la promesa de «descartar es reversible»
 * quedaba escrita solo en el backend.
 */
const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const cliente = readFileSync(
  path.join(RAIZ, "src", "components", "prospects", "prospects-client.tsx"),
  "utf8"
);
const ruta = readFileSync(
  path.join(RAIZ, "src", "app", "api", "prospects", "dismiss", "route.ts"),
  "utf8"
);

describe("la tarjeta de Prospectos", () => {
  it("ofrece Descartar y Restaurar contra la ruta de descartes", () => {
    expect(cliente.match(/"Descartar"/)).not.toBeNull();
    expect(cliente.match(/"Restaurar"/)).not.toBeNull();
    expect(cliente.match(/fetch\(\s*restore \? `\/api\/prospects\/dismiss/)).not.toBeNull();
  });

  it("cada tarjeta elige la acción según su propio estado", () => {
    // `dismissed` sale del DTO, no del filtro: la casilla solo cambia qué filas
    // llegan, y el botón tiene que decir Restaurar justo en las descartadas.
    expect(cliente.match(/const dismissed = Boolean\(p\.dismissedAt\)/)).not.toBeNull();
    expect(cliente.match(/setDismissed\(p, dismissed\)/)).not.toBeNull();
    expect(cliente.match(/\(descartado\)/)).not.toBeNull();
  });

  it("el fallo de un descarte se avisa, no deja la tarjeta como si nada", () => {
    expect(cliente.match(/No se pudo descartar/)).not.toBeNull();
    expect(cliente.match(/No se pudo restaurar/)).not.toBeNull();
    // Un descarte que no se guardó no puede desaparecer de la lista.
    expect(cliente.match(/catch \{[\s\S]*?setActionError\(\{ key, restore \}\)/)).not.toBeNull();
  });

  it("la casilla dice que también muestra descartados", () => {
    expect(cliente).toContain("Ver archivados y descartados");
  });

  it("el correo del prospecto pasa por mailtoHref antes de ir a un href", () => {
    // La dirección viene del `From:` de un mensaje entrante: es dato ajeno.
    expect(cliente.match(/const mail = p\.email \? mailtoHref\(p\.email\) : null/)).not.toBeNull();
    expect(cliente).not.toContain("mailto:${encodeURIComponent");
  });
});

describe("el contrato de la ruta", () => {
  it("restaurar se pide por query, no con body en un DELETE", () => {
    expect(ruta.match(/export const DELETE = withAuth/)).not.toBeNull();
    expect(ruta.match(/new URL\(req\.url\)/)).not.toBeNull();
    expect(ruta.match(/searchParams\.get\("contactId"\)/)).not.toBeNull();
    expect(ruta).not.toMatch(/DELETE[\s\S]{0,200}parseBody\(req/);
  });

  it("descartar es para cualquier miembro autenticado, no solo el dueño", () => {
    expect(ruta.match(/export const POST = withAuth/)).not.toBeNull();
    expect(ruta.match(/export const DELETE = withAuth/)).not.toBeNull();
    // El comentario del archivo explica justamente por qué NO es withOwner, así
    // que se ancla al manejador y no a la palabra suelta.
    expect(ruta).not.toMatch(/export const (POST|DELETE) = withOwner/);
  });
});
