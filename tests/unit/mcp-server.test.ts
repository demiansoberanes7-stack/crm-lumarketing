import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpServer } from "@/server/mcp/server";

/**
 * Verifica qué herramientas anuncia el servidor MCP por tier, sin tocar la
 * base de datos: tools/list y health_check no requieren datos.
 */

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.MCP_AUTH_BASE_URL = "https://crm.example.com";
  delete process.env.APP_BASE_URL;
  delete process.env.MCP_WRITE_ENABLED;
  delete process.env.MCP_DELETE_ENABLED;
  delete process.env.MCP_SEND_ENABLED;
  delete process.env.MCP_ADMIN_ENABLED;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

const READ_TOOLS = [
  "health_check",
  "get_profile",
  "list_contacts",
  "get_contact",
  "get_pipeline",
  "list_quotes",
  "list_catalog",
  "get_commercial_metrics",
  "actions_list",
  "actions_describe",
  "actions_run",
];

async function withServer(run: (client: Client) => Promise<void>): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await run(client);
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

async function toolNames(): Promise<string[]> {
  let names: string[] = [];
  await withServer(async (client) => {
    const result = await client.listTools();
    names = result.tools.map((tool) => tool.name);
  });
  return names;
}

describe("herramientas anunciadas por tier", () => {
  it("siempre anuncia lectura y las meta-herramientas", async () => {
    const names = await toolNames();
    for (const name of READ_TOOLS) expect(names).toContain(name);
    expect(names).not.toContain("create_contact");
    expect(names).not.toContain("delete_contact");
    expect(names).not.toContain("update_contact");
  });

  it("anuncia las de escritura con MCP_WRITE_ENABLED=true", async () => {
    process.env.MCP_WRITE_ENABLED = "true";
    const names = await toolNames();
    expect(names).toContain("create_contact");
    expect(names).toContain("update_contact");
    expect(names).toContain("create_quote");
    expect(names).toContain("move_lead");
    expect(names).toContain("set_quote_status");
    expect(names).not.toContain("delete_contact");
  });

  it("anuncia delete_contact solo con MCP_DELETE_ENABLED=true", async () => {
    process.env.MCP_DELETE_ENABLED = "true";
    const names = await toolNames();
    expect(names).toContain("delete_contact");
    expect(names).not.toContain("update_contact");
  });

  it("anuncia las de envío solo con MCP_SEND_ENABLED=true", async () => {
    let names = await toolNames();
    expect(names).not.toContain("send_message");
    expect(names).not.toContain("send_quote");
    expect(names).not.toContain("send_email");

    process.env.MCP_SEND_ENABLED = "true";
    names = await toolNames();
    expect(names).toContain("send_message");
    expect(names).toContain("send_quote");
    expect(names).toContain("send_email");
  });

  it("anuncia list_audit solo con MCP_ADMIN_ENABLED=true", async () => {
    let names = await toolNames();
    expect(names).not.toContain("list_audit");

    process.env.MCP_ADMIN_ENABLED = "true";
    names = await toolNames();
    expect(names).toContain("list_audit");
  });
});

describe("health_check", () => {
  it("responde sin autenticación ni base de datos", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({ name: "health_check", arguments: {} });
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({ status: "ok", readOnly: true });
    });
  });
});

describe("meta-herramientas sin token", () => {
  it("actions_list exige autenticación", async () => {
    await withServer(async (client) => {
      const result = await client.callTool({ name: "actions_list", arguments: {} });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]?.text).toMatch(/Authentication required/);
    });
  });
});
