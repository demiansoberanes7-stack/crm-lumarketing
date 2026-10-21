import { describe, expect, it } from "vitest";
import { tooltipTop } from "@/components/app-nav";

/**
 * El globo del tooltip del rail se posiciona contra el `<aside>`, no contra el
 * renglón, porque el `nav` es la región con scroll y recortaría un hijo suyo
 * que asome por la derecha. Esta resta es lo único que decide a qué altura
 * aparece la etiqueta: si se cae, el tooltip se descoloca de su icono.
 */
describe("tooltipTop", () => {
  it("cae en el centro vertical del renglón", () => {
    expect(tooltipTop({ top: 200, height: 44 }, { top: 12 })).toBe(210);
  });

  it("descuenta el desplazamiento del aside, no el de la ventana", () => {
    // Renglón idéntico en pantalla, con el aside 200px más abajo.
    expect(tooltipTop({ top: 400, height: 44 }, { top: 212 })).toBe(210);
  });

  it("mantiene el orden del menú cuando el rail tiene scroll", () => {
    const aside = { top: 30 };
    const primero = tooltipTop({ top: 100, height: 44 }, aside);
    const ultimo = tooltipTop({ top: 830, height: 44 }, aside);
    expect(ultimo - primero).toBe(730);
  });
});
