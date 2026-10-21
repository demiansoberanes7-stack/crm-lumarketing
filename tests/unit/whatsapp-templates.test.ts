import { describe, expect, it } from "vitest";
import {
  buildTemplateComponents,
  countTemplateVariables,
  normalizeTemplate,
  personalizeTemplateParams,
  renderTemplateText,
  templateRequiresOptIn,
} from "@/server/whatsapp/templates";

describe("plantillas de WhatsApp", () => {
  it("cuenta variables posicionales e ignora {{nombre}}", () => {
    expect(countTemplateVariables("Hola {{1}}, tu pedido {{2}} va en camino.")).toBe(2);
    expect(countTemplateVariables("Hola {{nombre}}, gracias.")).toBe(0);
    expect(countTemplateVariables("Sin variables.")).toBe(0);
  });

  it("renderiza solo las variables con valor y deja intactas las que falten", () => {
    expect(renderTemplateText("Hola {{1}}, pedido {{2}}.", ["Ana"])).toBe(
      "Hola Ana, pedido {{2}}."
    );
    expect(renderTemplateText("Hola {{1}}.", [])).toBe("Hola {{1}}.");
  });

  it("personaliza {{nombre}} por contacto, con respaldo si viene vacío", () => {
    expect(personalizeTemplateParams(["Hola {{nombre}}", "{{NOMBRE}}"], "Ana")).toEqual([
      "Hola Ana",
      "Ana",
    ]);
    expect(personalizeTemplateParams(["Hola {{nombre}}"], "  ")).toEqual([
      "Hola cliente",
    ]);
    expect(personalizeTemplateParams(["Valor fijo"], "Ana")).toEqual(["Valor fijo"]);
  });

  it("arma los componentes del cuerpo en orden", () => {
    expect(buildTemplateComponents([])).toEqual([]);
    expect(buildTemplateComponents(["Ana", "MXN 500"])).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Ana" },
          { type: "text", text: "MXN 500" },
        ],
      },
    ]);
  });

  it("antepone el encabezado multimedia al cuerpo", () => {
    expect(
      buildTemplateComponents(["Ana"], {
        format: "IMAGE",
        url: "https://cdn.lumarketing.digital/promo.jpg",
      })
    ).toEqual([
      {
        type: "header",
        parameters: [
          {
            type: "image",
            image: { link: "https://cdn.lumarketing.digital/promo.jpg" },
          },
        ],
      },
      { type: "body", parameters: [{ type: "text", text: "Ana" }] },
    ]);
  });

  it("detecta encabezados multimedia y bloquea los que no sabe enviar", () => {
    const media = normalizeTemplate({
      name: "promo_imagen",
      language: "es_MX",
      category: "MARKETING",
      components: [
        { type: "HEADER", format: "IMAGE" },
        { type: "BODY", text: "Hola {{1}}" },
      ],
    });
    expect(media).toMatchObject({
      headerFormat: "IMAGE",
      headerMediaRequired: true,
      automationIssue: null,
    });

    const textHeader = normalizeTemplate({
      name: "con_titulo",
      language: "es_MX",
      components: [
        { type: "HEADER", format: "TEXT", text: "Título fijo" },
        { type: "BODY", text: "Hola {{1}}" },
      ],
    });
    expect(textHeader).toMatchObject({
      headerFormat: "TEXT",
      headerMediaRequired: false,
      automationIssue: null,
    });

    const withVariableHeader = normalizeTemplate({
      name: "titulo_variable",
      language: "es_MX",
      components: [
        { type: "HEADER", format: "TEXT", text: "Hola {{1}}" },
        { type: "BODY", text: "Cuerpo" },
      ],
    });
    expect(withVariableHeader?.automationIssue).toMatch(/encabezado/);

    const location = normalizeTemplate({
      name: "ubicacion",
      language: "es_MX",
      components: [{ type: "HEADER", format: "LOCATION" }],
    });
    expect(location?.automationIssue).toMatch(/ubicación/i);
  });

  it("bloquea plantillas con variables en los botones", () => {
    const template = normalizeTemplate({
      name: "boton_variable",
      language: "es_MX",
      components: [
        { type: "BODY", text: "Hola" },
        {
          type: "BUTTONS",
          buttons: [{ type: "URL", text: "Ver", url: "https://x.mx/{{1}}" }],
        },
      ],
    });
    expect(template?.automationIssue).toMatch(/botones/);
  });

  it("normaliza respuestas de Meta y de Zernio", () => {
    const meta = normalizeTemplate({
      id: "1",
      name: "promo_octubre",
      language: "es_MX",
      status: "APPROVED",
      category: "marketing",
      components: [
        { type: "HEADER", text: "Hola" },
        { type: "BODY", text: "Hola {{1}}, tenemos {{2}}." },
      ],
    });
    expect(meta).toMatchObject({
      name: "promo_octubre",
      language: "es_MX",
      category: "MARKETING",
      variableCount: 2,
    });

    const zernio = normalizeTemplate({
      name: "recordatorio",
      language: { code: "es" },
      category: "UTILITY",
      components: [{ type: "body", text: "Recordatorio para {{1}}" }],
    });
    expect(zernio).toMatchObject({
      name: "recordatorio",
      language: "es",
      category: "UTILITY",
      variableCount: 1,
    });
  });

  it("descarta plantillas sin nombre o idioma", () => {
    expect(normalizeTemplate({ name: "", language: "es" })).toBeNull();
    expect(normalizeTemplate({ name: "promo", language: "" })).toBeNull();
  });

  it("solo las plantillas de marketing exigen opt-in", () => {
    expect(templateRequiresOptIn("MARKETING")).toBe(true);
    expect(templateRequiresOptIn("marketing")).toBe(true);
    expect(templateRequiresOptIn("UTILITY")).toBe(false);
    expect(templateRequiresOptIn(null)).toBe(false);
  });
});
