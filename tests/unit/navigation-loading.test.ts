import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Síntoma reportado: al pulsar el menú lateral la URL cambia pero la interfaz
 * se queda en «Cargando…».
 *
 * Apollo la URL al clic; el segmento nuevo se pinta cuando llega el payload
 * RSC. Sin `loading.tsx` no hay ningún estado intermedio, y si un loader deja
 * su centinela `null` tras fallar, la pantalla no sale nunca de «Cargando…»
 * porque la rama de error es inalcanzable. Estas pruebas fijan las tres
 * piezas: la frontera de carga, el centinela que se libera y la suscripción
 * SSE única por pestaña.
 *
 * Se prueba sobre el código fuente porque el entorno Vitest es `node`, sin DOM.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const leer = (...rel: string[]) => readFileSync(path.join(RAIZ, ...rel), "utf8");

describe("frontera de carga al navegar", () => {
  it("(app) tiene loading.tsx y anuncia el estado a lectores de pantalla", () => {
    const ruta = path.join(RAIZ, "src", "app", "(app)", "loading.tsx");
    expect(existsSync(ruta), "falta src/app/(app)/loading.tsx").toBe(true);
    const fuente = readFileSync(ruta, "utf8");
    expect(fuente).toMatch(/role="status"/);
    expect(fuente).toMatch(/aria-live="polite"/);
    expect(fuente).toMatch(/Cargando/);
  });
});

describe("la bandeja sale de «Cargando…» aunque la lectura falle", () => {
  const inbox = leer("src", "components", "inbox", "inbox-client.tsx");

  it("el bloque de fallo libera el centinela `null` de la lista", () => {
    // `loading` en conversation-list es `conversations === null`: si el fallo
    // lo deja en null, `loadFailed` nunca se pinta.
    const bloque = /if \(!res\?\.ok\) \{([\s\S]*?)\n    \}/.exec(inbox);
    expect(bloque, "cambió la forma del bloque de fallo en refetchConversations").not.toBeNull();
    expect(bloque?.[1]).toMatch(/setListFailed\(true\)/);
    expect(bloque?.[1], "el fallo debe vaciar el centinela de carga").toMatch(
      /setConversations\(\(prev\) => prev \?\? \[\]\)/
    );
  });
});

describe("una sola suscripción SSE por pestaña", () => {
  const nav = leer("src", "components", "app-nav.tsx");
  const shell = leer("src", "components", "app-shell.tsx");
  const events = leer("src", "app", "api", "events", "route.ts");

  it("el rail ya no abre su propio EventSource: recibe el contador por props", () => {
    expect(nav).not.toMatch(/useUnreadCount/);
    expect(nav).not.toMatch(/new EventSource/);
    expect(nav).toMatch(/unread:\s*number \| null/);
  });

  it("el cascarón, que sí se suscribe, pasa el contador al rail", () => {
    expect(shell).toMatch(/const unread = useUnreadCount\(\)/);
    expect(shell).toMatch(/<AppNav[\s\S]*?unread=\{unread\}/);
  });

  it("el tope por organización aguanta al menos dos pestañas de Bandeja", () => {
    // Por pestaña: 1 del cascarón + 1 de la pantalla = 2. Dos pestañas son 4.
    const tope = /const MAX_SSE_CONNECTIONS = (\d+)/.exec(events);
    expect(tope, "desapareció el tope de conexiones SSE").not.toBeNull();
    expect(Number(tope?.[1])).toBeGreaterThanOrEqual(10);
  });
});

describe("la ficha de cotización no se queda cargando", () => {
  const quote = leer("src", "components", "quotes", "quote-detail.tsx");

  it("la lectura tiene timeout y marca el fallo", () => {
    expect(quote).toMatch(/AbortSignal\.timeout\(/);
    expect(quote).toMatch(/setLoadFailed\(true\)/);
  });

  it("hay una rama de error con reintento antes del «Cargando…»", () => {
    const idxError = quote.indexOf("No se pudo cargar la cotización");
    const idxCargando = quote.indexOf(">Cargando…<");
    expect(idxError, "falta el aviso de error de la ficha").toBeGreaterThan(-1);
    expect(idxCargando, "desapareció el estado de carga de la ficha").toBeGreaterThan(-1);
    expect(idxError).toBeLessThan(idxCargando);
    expect(quote).toMatch(/if \(!quote && loadFailed\)/);
  });
});
