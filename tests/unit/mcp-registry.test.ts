import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerAllActions } from "@/server/mcp/actions";
import type { McpPrincipal } from "@/server/mcp/oauth";
import {
  availableActions,
  defineAction,
  findAction,
  getAllActions,
  isActionAvailable,
  zodToInputSchema,
} from "@/server/mcp/registry";

function principalWith(scopes: string[]): McpPrincipal {
  return {
    userId: "usr_test",
    organizationId: "org_test",
    scopes: new Set(scopes),
    clientId: "https://chatgpt.com/oauth/client.json",
  };
}

const savedEnv = { ...process.env };

beforeEach(() => {
  delete process.env.MCP_WRITE_ENABLED;
  delete process.env.MCP_DELETE_ENABLED;
  delete process.env.MCP_SEND_ENABLED;
  delete process.env.MCP_ADMIN_ENABLED;
  registerAllActions();
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("registro de acciones (contactos)", () => {
  it("expone las acciones del dominio con su tier y scope", () => {
    const expected: Record<string, { kind: string; scope: string }> = {
      "contacts.create": { kind: "write", scope: "crm.contacts.write" },
      "contacts.update": { kind: "write", scope: "crm.contacts.write" },
      "contacts.add_note": { kind: "write", scope: "crm.contacts.write" },
      "contacts.delete": { kind: "delete", scope: "crm.contacts.delete" },
      "contacts.get": { kind: "read", scope: "crm.contacts.read" },
    };
    for (const [name, meta] of Object.entries(expected)) {
      const action = findAction(name);
      expect(action, `falta la acción ${name}`).toBeDefined();
      expect(action?.kind).toBe(meta.kind);
      expect(action?.scope).toBe(meta.scope);
      expect(action?.domain).toBe("contacts");
    }
  });

  it("marca contacts.delete como destructiva", () => {
    expect(findAction("contacts.delete")?.destructive).toBe(true);
    expect(findAction("contacts.create")?.destructive).toBeUndefined();
  });

  it("no registra nombres duplicados", () => {
    const names = getAllActions().map((action) => action.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("re-registro idempotente (alta repetida no duplica)", () => {
    const before = getAllActions().length;
    registerAllActions();
    expect(getAllActions().length).toBe(before);
  });
});

describe("registro de acciones (pipeline, cotizaciones, catálogo)", () => {
  it("pipeline.update_lead usa el scope de escritura del pipeline", () => {
    const action = findAction("pipeline.update_lead");
    expect(action?.kind).toBe("write");
    expect(action?.scope).toBe("crm.pipeline.write");
    expect(action?.domain).toBe("pipeline");
  });

  it("cotizaciones reparte lectura, escritura y borrado", () => {
    const expected: Record<string, { kind: string; scope: string }> = {
      "quotes.list": { kind: "read", scope: "crm.quotes.read" },
      "quotes.get": { kind: "read", scope: "crm.quotes.read" },
      "quotes.create": { kind: "write", scope: "crm.quotes.write" },
      "quotes.update": { kind: "write", scope: "crm.quotes.write" },
      "quotes.set_status": { kind: "write", scope: "crm.quotes.write" },
      "quotes.archive": { kind: "write", scope: "crm.quotes.write" },
      "quotes.unarchive": { kind: "write", scope: "crm.quotes.write" },
      "quotes.delete": { kind: "delete", scope: "crm.quotes.delete" },
    };
    for (const [name, meta] of Object.entries(expected)) {
      const action = findAction(name);
      expect(action, `falta la acción ${name}`).toBeDefined();
      expect(action?.kind).toBe(meta.kind);
      expect(action?.scope).toBe(meta.scope);
    }
  });

  it("catálogo: lectura siempre; crear/actualizar con el tier de escritura", () => {
    expect(findAction("catalog.list")?.scope).toBe("crm.catalog.read");
    const update = findAction("catalog.update")!;
    expect(update.kind).toBe("write");
    expect(update.scope).toBe("crm.catalog.write");
    expect(isActionAvailable(principalWith(["crm.catalog.write"]), update)).toBe(false);
    process.env.MCP_WRITE_ENABLED = "true";
    expect(isActionAvailable(principalWith(["crm.catalog.write"]), update)).toBe(true);
  });

  it("quotes.delete exige tier de borrado y scope de borrado", () => {
    const action = findAction("quotes.delete")!;
    const owner = principalWith(["crm.quotes.delete"]);
    expect(action.destructive).toBe(true);
    expect(isActionAvailable(owner, action)).toBe(false);
    process.env.MCP_DELETE_ENABLED = "true";
    expect(isActionAvailable(owner, action)).toBe(true);
    expect(isActionAvailable(principalWith(["crm.quotes.write"]), action)).toBe(false);
  });

  it("pipeline.update_lead exige etapa, monto o prioridad (sin tocar BD)", async () => {
    const action = findAction("pipeline.update_lead")!;
    const principal = principalWith(["crm.pipeline.write"]);
    await expect(action.execute(principal, { leadId: "ld_1" })).rejects.toThrow(
      /etapa, monto o prioridad/
    );
  });
});

describe("registro de acciones (envíos y bandeja)", () => {
  it("acciones de envío usan el tier send con su scope", () => {
    const expected: Record<string, string> = {
      "messages.send": "crm.messages.send",
      "quotes.send": "crm.quotes.send",
      "email.send": "crm.email.send",
    };
    for (const [name, scope] of Object.entries(expected)) {
      const action = findAction(name);
      expect(action, `falta la acción ${name}`).toBeDefined();
      expect(action?.kind).toBe("send");
      expect(action?.scope).toBe(scope);
      expect(action?.destructive).toBe(true);
    }
  });

  it("el tier de envío apagado oculta todas las acciones de envío", () => {
    const sender = principalWith(["crm.messages.send", "crm.quotes.send", "crm.email.send"]);
    for (const name of ["messages.send", "quotes.send", "email.send"]) {
      expect(isActionAvailable(sender, findAction(name)!)).toBe(false);
    }
    process.env.MCP_SEND_ENABLED = "true";
    for (const name of ["messages.send", "quotes.send", "email.send"]) {
      expect(isActionAvailable(sender, findAction(name)!)).toBe(true);
    }
    expect(isActionAvailable(principalWith([]), findAction("messages.send")!)).toBe(false);
  });

  it("lecturas de bandeja y correo están siempre disponibles con su scope", () => {
    const reader = principalWith(["crm.conversations.read", "crm.email.read"]);
    const names = availableActions(reader).map((action) => action.name);
    expect(names).toContain("conversations.list");
    expect(names).toContain("messages.list");
    expect(names).toContain("email.accounts");
    expect(names).not.toContain("messages.send");
  });

  it("email.accounts no expone credenciales en su esquema", () => {
    const schema = zodToInputSchema(findAction("email.accounts")!.inputSchema);
    expect(schema).toEqual({ type: "object", properties: {} });
  });
});

describe("registro de acciones (ajustes y admin)", () => {
  it("las lecturas de ajustes usan el scope de lectura", () => {
    const expected: Record<string, string> = {
      "settings.get": "crm.settings.read",
      "members.list": "crm.settings.read",
      "connections.status": "crm.settings.read",
    };
    for (const [name, scope] of Object.entries(expected)) {
      const action = findAction(name);
      expect(action, `falta la acción ${name}`).toBeDefined();
      expect(action?.kind).toBe("read");
      expect(action?.scope).toBe(scope);
      expect(action?.domain).toBe("settings");
    }
  });

  it("el tier admin apagado oculta admin.audit_list; encendido lo muestra", () => {
    const action = findAction("admin.audit_list");
    expect(action?.kind).toBe("admin");
    expect(action?.scope).toBe("crm.audit.read");
    expect(action?.domain).toBe("admin");

    const reader = principalWith(["crm.audit.read"]);
    expect(isActionAvailable(reader, action!)).toBe(false);

    process.env.MCP_ADMIN_ENABLED = "true";
    expect(isActionAvailable(reader, action!)).toBe(true);

    const withoutScope = principalWith(["crm.settings.read"]);
    expect(isActionAvailable(withoutScope, action!)).toBe(false);
  });

  it("settings.get no expone credenciales en su esquema (entrada vacía)", () => {
    const schema = zodToInputSchema(findAction("settings.get")!.inputSchema);
    expect(schema).toEqual({ type: "object", properties: {} });
  });
});

describe("availableActions: tier + scope", () => {
  const readPrincipal = principalWith(["crm.contacts.read"]);

  it("solo ve lectura cuando los tiers de escritura/borrado están apagados", () => {
    const names = availableActions(readPrincipal).map((action) => action.name);
    expect(names).toContain("contacts.get");
    expect(names).not.toContain("contacts.create");
    expect(names).not.toContain("contacts.delete");
  });

  it("incluye escritura con el tier encendido y el scope concedido", () => {
    process.env.MCP_WRITE_ENABLED = "true";
    const writer = principalWith(["crm.contacts.read", "crm.contacts.write"]);
    const names = availableActions(writer).map((action) => action.name);
    expect(names).toContain("contacts.create");
    expect(names).toContain("contacts.update");
    expect(names).not.toContain("contacts.delete");
  });

  it("nunca expone acciones cuyo scope no fue concedido", () => {
    process.env.MCP_WRITE_ENABLED = "true";
    const names = availableActions(readPrincipal).map((action) => action.name);
    expect(names).not.toContain("contacts.create");
  });

  it("exige el tier de borrado para contacts.delete", () => {
    const owner = principalWith(["crm.contacts.read", "crm.contacts.delete"]);
    expect(isActionAvailable(owner, findAction("contacts.delete")!)).toBe(false);
    process.env.MCP_DELETE_ENABLED = "true";
    expect(isActionAvailable(owner, findAction("contacts.delete")!)).toBe(true);
    expect(isActionAvailable(readPrincipal, findAction("contacts.delete")!)).toBe(false);
  });
});

describe("defineAction: validación de entrada", () => {
  it("rechaza entradas inválidas sin ejecutar el handler", async () => {
    let called = false;
    const action = defineAction({
      name: "test.echo",
      domain: "test",
      kind: "read",
      scope: "crm.profile.read",
      title: "Echo",
      description: "Devuelve el texto",
      input: z.object({ text: z.string().min(3) }),
      handler: async (_principal, input) => {
        called = true;
        return { text: input.text };
      },
    });

    await expect(action.execute(principalWith([]), { text: "x" })).rejects.toThrow();
    expect(called).toBe(false);

    const result = await action.execute(principalWith([]), { text: "hola" });
    expect(called).toBe(true);
    expect(result.text).toBe("hola");
  });
});

describe("zodToInputSchema", () => {
  it("describe propiedades y requeridas de un objeto", () => {
    const schema = z.object({
      name: z.string(),
      limit: z.number().int().optional(),
      tags: z.array(z.string()).optional(),
    });
    expect(zodToInputSchema(schema)).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        limit: { type: "number" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["name"],
    });
  });

  it("desenvuelve refinamientos (.refine) y enumera enums", () => {
    const schema = z
      .object({ status: z.enum(["accepted", "rejected"]) })
      .refine((value) => value.status === "accepted");
    expect(zodToInputSchema(schema)).toEqual({
      type: "object",
      properties: { status: { type: "string", enum: ["accepted", "rejected"] } },
      required: ["status"],
    });
  });

  it("la descripción de contacts.update expone su argumento obligatorio", () => {
    const schema = zodToInputSchema(findAction("contacts.update")!.inputSchema);
    expect(schema.type).toBe("object");
    const properties = schema.properties as Record<string, { type?: string }>;
    expect(properties.contactId?.type).toBe("string");
    expect(schema.required).toEqual(["contactId"]);
  });
});
