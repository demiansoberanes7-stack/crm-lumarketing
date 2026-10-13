import { describe, expect, it } from "vitest";
import { AgentAction, degradeAction } from "@/server/ai/actions";

describe("acciones de cotización del agente", () => {
  it("valida cantidad formal y rechaza cantidades fuera de rango", () => {
    expect(AgentAction.safeParse({
      action: "create_quote",
      item_id: "cat_product",
      quantity: 3,
    }).success).toBe(true);
    expect(AgentAction.safeParse({
      action: "create_quote",
      item_id: "cat_product",
      quantity: 101,
    }).success).toBe(false);
  });

  it("degrada la creación formal si el motor no puede ejecutarla", () => {
    expect(degradeAction({ action: "create_quote", item_id: "cat_product", quantity: 2, reply: "Claro" })).toEqual({
      action: "reply",
      text: "Claro",
    });
    expect(degradeAction({ action: "create_quote", item_id: "cat_product" })).toEqual({ action: "none" });
  });
});
