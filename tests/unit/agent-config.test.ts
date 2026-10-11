import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_FICHA_FIELDS,
  DEFAULT_AGENT_RULES,
  filterAgentFichaToConfiguredFields,
  fichaFieldKeyFromLabel,
  normalizeAgentFichaFields,
  normalizeAgentRules,
} from "@/lib/agent-config";

describe("configuración del agente", () => {
  it("conserva los valores predeterminados cuando la configuración es vieja o inválida", () => {
    expect(normalizeAgentRules(null)).toEqual(DEFAULT_AGENT_RULES);
    expect(normalizeAgentFichaFields(null)).toEqual(DEFAULT_AGENT_FICHA_FIELDS);
    expect(normalizeAgentFichaFields([{ key: "no espacios", label: "Inválido" }])).toEqual(DEFAULT_AGENT_FICHA_FIELDS);
  });

  it("normaliza solo las reglas booleanas conocidas y rellena valores ausentes", () => {
    expect(normalizeAgentRules({ sendProductQuotes: false, unknowable: true })).toEqual({
      ...DEFAULT_AGENT_RULES,
      sendProductQuotes: false,
    });
  });

  it("genera claves cortas desde etiquetas y limita los datos escritos a los campos configurados", () => {
    expect(fichaFieldKeyFromLabel("Ubicación del cliente")).toBe("ubicacion_del_cliente");
    expect(filterAgentFichaToConfiguredFields(
      { ubicacion: "León", secreto: "no guardar", presupuesto: "$20,000" },
      [
        { key: "ubicacion", label: "Ubicación" },
        { key: "presupuesto", label: "Presupuesto" },
      ]
    )).toEqual({ ubicacion: "León", presupuesto: "$20,000" });
  });
});
