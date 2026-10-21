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

  it("acepta varias líneas de cotización y rechaza listas vacías o demasiado largas", () => {
    expect(AgentAction.safeParse({
      action: "create_quote",
      items: [
        { item_id: "cat_a", quantity: 1 },
        { item_id: "cat_b", quantity: 3 },
      ],
    }).success).toBe(true);
    expect(AgentAction.safeParse({ action: "create_quote", items: [] }).success).toBe(false);
    expect(AgentAction.safeParse({
      action: "create_quote",
      items: Array.from({ length: 11 }, (_, i) => ({ item_id: `cat_${i}`, quantity: 1 })),
    }).success).toBe(false);
  });

  it("manda varias fichas en una sola acción", () => {
    expect(AgentAction.safeParse({ action: "send_quote", item_id: "cat_a" }).success).toBe(true);
    expect(AgentAction.safeParse({
      action: "send_quote",
      item_ids: ["cat_a", "cat_b"],
      reply: "Aquí van:",
    }).success).toBe(true);
    expect(AgentAction.safeParse({ action: "send_quote", item_ids: [] }).success).toBe(false);
    expect(AgentAction.safeParse({
      action: "send_quote",
      item_ids: Array.from({ length: 6 }, (_, i) => `cat_${i}`),
    }).success).toBe(false);
    // Sin ningún ID la acción sigue siendo válida: el motor es el que pregunta
    // qué producto quiere el cliente, igual que en create_quote.
    expect(AgentAction.safeParse({ action: "send_quote" }).success).toBe(true);
  });

  it("valida la búsqueda de inventario y la degrada a respuesta si no se puede ejecutar", () => {
    expect(AgentAction.safeParse({ action: "search_inventory", query: "ramo rojo" }).success).toBe(true);
    expect(AgentAction.safeParse({ action: "search_inventory", query: "" }).success).toBe(false);
    expect(degradeAction({ action: "search_inventory", query: "ramo", reply: "Reviso." })).toEqual({
      action: "reply",
      text: "Reviso.",
    });
    expect(degradeAction({ action: "search_inventory", query: "ramo" })).toEqual({ action: "none" });
  });
});
