import { describe, expect, it } from "vitest";
import { parseCsv, stringifyCsv } from "@/lib/csv";

/**
 * Inyección de fórmulas en los CSV que exporta el CRM (Contactos, Inventario).
 *
 * El archivo se genera con lo que escribió gente de fuera —notas de un
 * contacto, el nombre de un prospecto tomado del chat— y Excel o Sheets
 * EVALÚAN la celda que empieza por `=`, `+`, `-` o `@`. Un
 * `=HYPERLINK("http://malicioso.mx","Ver factura")` en la nota de un contacto
 * sale del CRM convertido en un botón que el dueño pulsa creyendo que es su
 * propia información.
 */
const cell = (nota: string) => stringifyCsv([{ nombre: "Ana", notas: nota }], ["nombre", "notas"]);

describe("escapeCsvCell vía stringifyCsv", () => {
  it("neutraliza el inicio de fórmula con comilla simple", () => {
    expect(cell('=HYPERLINK("http://malicioso.mx","Ver factura")')).toContain(
      `"'=HYPERLINK(""http://malicioso.mx"",""Ver factura"")"`
    );
    expect(cell("@SUM(A1:A9)")).toContain("'@SUM(A1:A9)");
    expect(cell("+1 555 0100")).toContain("'+1 555 0100");
  });

  it("no se deja engañar por el espacio o el tabulador previos", () => {
    // Excel ignora el espacio inicial antes de mirar si hay fórmula.
    expect(cell(" =cmd|'/c calc'!A1")).toContain("' =cmd");
    expect(cell("\t=cmd")).toContain("'\t=cmd");
  });

  it("deja intactos los números negativos: son importes, no fórmulas", () => {
    // `monto_compra` puede venir en `-150.00` (una devolución). Convertirlo en
    // texto rompería las sumas que el dueño hace en Excel.
    expect(cell("-150.00")).toContain(",-150.00");
    expect(stringifyCsv([{ monto: -150.0 }], ["monto"])).toContain("-150");
  });

  it("no toca el texto normal ni las comas que ya se entrecomillan", () => {
    expect(cell("Cliente frecuente")).toContain("Cliente frecuente");
    expect(cell("rama, roja")).toContain(`"rama, roja"`);
    expect(cell("con comillas \"dobles\"")).toContain(`"con comillas ""dobles"""`);
  });

  it("el encabezado y el resto del formato siguen siendo los de siempre", () => {
    expect(stringifyCsv([{ a: "1", b: "2" }])).toBe("a,b\n1,2");
  });

  it("sigue siendo legible por el propio parser (el `'` es texto literal)", () => {
    const csv = cell("=peligroso");
    const back = parseCsv(csv);
    expect(back[0]?.notas).toBe("'=peligroso");
  });
});
