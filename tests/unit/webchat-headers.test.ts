import { describe, expect, it } from "vitest";

/**
 * El panel del chat del sitio vive en un <iframe> dentro de la web del cliente,
 * es decir: en un origen distinto. Con la cabecera global `X-Frame-Options:
 * SAMEORIGIN` el navegador se niega a pintarlo ("Refused to display ... because
 * it set 'X-Frame-Options' to 'sameorigin'") y el widget queda como una burbuja
 * que no abre nada. Se detectó justo así, en el navegador, no en los tests.
 *
 * Esta prueba fija las dos mitades del contrato: el embed se puede enmarcar y
 * el resto de la app sigue protegido contra clickjacking.
 */
describe("cabeceras del panel embebido", () => {
  it("el chat se puede enmarcar y el resto de la app no", async () => {
    const config = (await import("../../next.config")).default;
    const rules = await config.headers!();

    const embed = rules.find((rule) => rule.source === "/embed/webchat");
    expect(embed).toBeDefined();
    expect(embed!.headers.map((h) => h.key)).not.toContain("X-Frame-Options");
    expect(embed!.headers).toContainEqual({
      key: "Content-Security-Policy",
      value: "frame-ancestors *",
    });

    // Una sola regla comodín, y tiene que excluir el embed: dos reglas que
    // fijen la misma clave dejan el resultado a merced del orden interno del
    // servidor, que es exactamente el tipo de fallo que no se ve en local.
    const rest = rules.filter((rule) => rule !== embed);
    expect(rest).toHaveLength(1);
    expect(rest[0]!.source).toContain("(?!embed/webchat)");
    expect(rest[0]!.headers).toContainEqual({
      key: "X-Frame-Options",
      value: "SAMEORIGIN",
    });
  });
});
