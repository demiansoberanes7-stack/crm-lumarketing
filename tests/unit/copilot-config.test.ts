import { describe, expect, it } from "vitest";
import {
  COPILOT_DATA_SOURCES,
  DEFAULT_COPILOT_SETTINGS,
  enabledCopilotDataSources,
  normalizeCopilotDataSources,
} from "@/lib/copilot-config";

describe("configuración de fuentes del Copiloto", () => {
  it("mantiene un alcance inicial de consulta que conserva las fuentes actuales", () => {
    expect(DEFAULT_COPILOT_SETTINGS).toMatchObject({
      accessMode: "selected",
      dataSources: ["metrics", "pipeline", "contacts", "agenda"],
    });
  });

  it("el modo todo habilita solo las fuentes registradas por el CRM", () => {
    expect(enabledCopilotDataSources({ accessMode: "all", dataSources: [] })).toEqual(
      new Set(COPILOT_DATA_SOURCES.map((source) => source.key))
    );
  });

  it("normaliza claves desconocidas y elimina duplicados", () => {
    expect(normalizeCopilotDataSources(["pipeline", "pipeline", "drop_table"])).toEqual(["pipeline"]);
  });
});
