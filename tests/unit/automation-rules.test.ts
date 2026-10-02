import { describe, expect, it } from "vitest";
import { findAutomationRule } from "@/server/automation-rules";

describe("reglas de automatización persistidas", () => {
  it("valida nombre, canal, habilitación, texto y demora antes de consumirlos", () => {
    expect(findAutomationRule([{
      id: "followup-3d",
      name: "Seguimiento",
      enabled: true,
      delayHours: 48,
      messageText: "Hola",
      channel: "email",
    }], "followup-3d")).toEqual({
      id: "followup-3d",
      name: "Seguimiento",
      enabled: true,
      delayHours: 48,
      messageText: "Hola",
      channel: "email",
    });
  });

  it("ignora la forma inválida y no acepta demoras o canales fuera de contrato", () => {
    expect(findAutomationRule(null, "followup-3d")).toBeNull();
    expect(findAutomationRule([{ id: "followup-3d", delayHours: -4, channel: "sms" }], "followup-3d"))
      .toEqual({ id: "followup-3d" });
  });
});
