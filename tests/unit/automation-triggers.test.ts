import { describe, expect, it } from "vitest";
import {
  AUTOMATION_TRIGGERS,
  listAutomationRules,
  resolveAutomationTriggers,
} from "@/server/automation-rules";

describe("disparos automáticos de las reglas", () => {
  it("traduce los textos de las tarjetas a claves que el worker compara", () => {
    expect(resolveAutomationTriggers({ trigger: "Lead pasa a etapa «Cotizado» o no hay actividad" }))
      .toEqual(["stage_change", "inactivity"]);
    expect(resolveAutomationTriggers({ trigger: "Sin respuesta tras primer seguimiento" }))
      .toEqual(["no_reply"]);
    expect(resolveAutomationTriggers({ trigger: "Nuevo lead entra al pipeline" }))
      .toEqual(["new_lead"]);
  });

  it("una regla sin texto reconocible queda solo con el disparo manual", () => {
    expect(resolveAutomationTriggers({})).toEqual([]);
    expect(resolveAutomationTriggers({ trigger: " " })).toEqual([]);
    expect(resolveAutomationTriggers({ trigger: "Imprimir factura" })).toEqual([]);
  });

  it("las claves guardadas mandan sobre el texto y no se repiten", () => {
    expect(resolveAutomationTriggers({
      trigger: "Lead pasa a etapa «Cotizado» o no hay actividad",
      triggers: ["no_reply", "no_reply", "new_lead"],
    })).toEqual(["no_reply", "new_lead"]);
    // Claves inválidas se descartan y, si no queda ninguna, vuelve al texto.
    expect(resolveAutomationTriggers({ trigger: "Nuevo lead entra al pipeline", triggers: ["vuela"] }))
      .toEqual(["new_lead"]);
  });

  it("normaliza acentos y mayúsculas en el texto heredado", () => {
    expect(resolveAutomationTriggers({ trigger: "INACTIVIDAD durante 3 días" }))
      .toEqual(["inactivity"]);
    expect(resolveAutomationTriggers({ trigger: "Llega un Lead NUEVO al Pipeline" }))
      .toEqual(["new_lead"]);
  });

  it("parsea las claves y la etapa objetivo que ahora guarda la API", () => {
    expect(listAutomationRules([{
      id: "followup-3d",
      triggers: ["stage_change", "inactivity"],
      stageId: "stage_abc",
    }])).toEqual([{
      id: "followup-3d",
      triggers: ["stage_change", "inactivity"],
      stageId: "stage_abc",
    }]);

    // Claves desconocidas y etapa vacía no contaminan la regla.
    expect(listAutomationRules([{
      id: "followup-3d",
      triggers: ["stage_change", "telepatia"],
      stageId: "",
    }])).toEqual([{ id: "followup-3d", triggers: ["stage_change"] }]);
  });

  it("el catálogo de claves es el que la cola y los hooks usan", () => {
    expect([...AUTOMATION_TRIGGERS]).toEqual(["stage_change", "inactivity", "new_lead", "no_reply"]);
    // `triggered_by` es varchar(20): ninguna clave puede pasarse de largo.
    for (const key of AUTOMATION_TRIGGERS) expect(key.length).toBeLessThanOrEqual(20);
  });
});
