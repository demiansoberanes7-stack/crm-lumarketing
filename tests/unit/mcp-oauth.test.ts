import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MCP_DELETE_SCOPES,
  MCP_READ_SCOPES,
  actionKindEnabled,
  clientIsAllowed,
  isAllowedClient,
  isAllowedRedirectUri,
  normalizeScopes,
  supportedScopes,
  unauthorizedChallengeResponse,
  validateRegistrationRedirectUris,
} from "@/server/mcp/oauth";

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.MCP_AUTH_BASE_URL = "https://crm.example.com";
  delete process.env.APP_BASE_URL;
  delete process.env.MCP_RESOURCE_URL;
  delete process.env.MCP_OAUTH_ISSUER;
  delete process.env.MCP_WRITE_ENABLED;
  delete process.env.MCP_DELETE_ENABLED;
  delete process.env.MCP_SEND_ENABLED;
  delete process.env.MCP_ADMIN_ENABLED;
  delete process.env.MCP_DCR_ENABLED;
  delete process.env.MCP_DCR_ALLOWED_HOSTS;
  delete process.env.MCP_ALLOWED_CLIENT_IDS;
  delete process.env.MCP_ALLOWED_REDIRECT_URIS;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("normalizeScopes", () => {
  it("default a solo lectura cuando no se pide scope", () => {
    expect(normalizeScopes(null)).toEqual([...MCP_READ_SCOPES]);
    expect(normalizeScopes("")).toEqual([...MCP_READ_SCOPES]);
  });

  it("acepta scopes de lectura y deduplica", () => {
    expect(normalizeScopes("crm.contacts.read crm.contacts.read crm.metrics.read")).toEqual([
      "crm.contacts.read",
      "crm.metrics.read",
    ]);
  });

  it("rechaza scopes desconocidos", () => {
    expect(() => normalizeScopes("crm.contacts.read crm.unknown")).toThrow(/Unsupported MCP scope/);
  });

  it("rechaza escritura mientras MCP_WRITE_ENABLED no sea true", () => {
    expect(() => normalizeScopes("crm.contacts.write")).toThrow(/Unsupported MCP scope/);
    process.env.MCP_WRITE_ENABLED = "true";
    expect(normalizeScopes("crm.contacts.write")).toEqual(["crm.contacts.write"]);
  });
});

describe("isAllowedClient", () => {
  it("acepta el client_id de ChatGPT (CIMD)", () => {
    expect(isAllowedClient("https://chatgpt.com/oauth/client.json")).toBe(true);
    expect(isAllowedClient("https://chatgpt.com/oauth/abc")).toBe(true);
  });

  it("rechaza clientes no reconocidos", () => {
    expect(isAllowedClient("https://evil.example.com/oauth")).toBe(false);
    expect(isAllowedClient("")).toBe(false);
  });

  it("acepta clientes de la lista blanca por entorno", () => {
    process.env.MCP_ALLOWED_CLIENT_IDS = "mcpc_123, https://otro.example.com/cli";
    expect(isAllowedClient("mcpc_123")).toBe(true);
    expect(isAllowedClient("https://otro.example.com/cli")).toBe(true);
  });
});

describe("isAllowedRedirectUri", () => {
  it("acepta el callback estándar de ChatGPT", () => {
    expect(isAllowedRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
    expect(isAllowedRedirectUri("https://chatgpt.com/connector/oauth/xyz")).toBe(true);
  });

  it("rechaza hosts y esquemas no permitidos", () => {
    expect(isAllowedRedirectUri("https://evil.example.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("http://chatgpt.com/connector_platform_oauth_redirect")).toBe(false);
    expect(isAllowedRedirectUri("no-es-url")).toBe(false);
  });
});

describe("validateRegistrationRedirectUris (DCR)", () => {
  it("acepta https de chatgpt.com", () => {
    expect(
      validateRegistrationRedirectUris(["https://chatgpt.com/connector_platform_oauth_redirect"])
    ).toEqual(["https://chatgpt.com/connector_platform_oauth_redirect"]);
  });

  it("rechaza http, hosts ajenos y listas vacías", () => {
    expect(() => validateRegistrationRedirectUris([])).toThrow();
    expect(() => validateRegistrationRedirectUris(["http://chatgpt.com/cb"])).toThrow();
    expect(() => validateRegistrationRedirectUris(["https://evil.example.com/cb"])).toThrow();
    expect(() => validateRegistrationRedirectUris("no-lista")).toThrow();
  });

  it("permite hosts extra configurados por entorno", () => {
    process.env.MCP_DCR_ALLOWED_HOSTS = "chatgpt.com,miproxy.example.com";
    expect(validateRegistrationRedirectUris(["https://miproxy.example.com/cb"])).toEqual([
      "https://miproxy.example.com/cb",
    ]);
  });
});

describe("unauthorizedChallengeResponse (reto 401 MCP)", () => {
  it("devuelve 401 con WWW-Authenticate apuntando al resource metadata", () => {
    const response = unauthorizedChallengeResponse();
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="https://crm.example.com/.well-known/oauth-protected-resource"'
    );
  });
});

describe("clientIsAllowed", () => {
  it("acepta CIMD sin tocar la base de datos", async () => {
    await expect(clientIsAllowed("https://chatgpt.com/oauth/client.json")).resolves.toBe(true);
    await expect(clientIsAllowed("https://evil.example.com/x")).resolves.toBe(false);
  });
});

describe("actionKindEnabled (tiers)", () => {
  it("lectura siempre; escritura/borrado/envío/admin solo con su bandera", () => {
    expect(actionKindEnabled("read")).toBe(true);
    expect(actionKindEnabled("write")).toBe(false);
    expect(actionKindEnabled("delete")).toBe(false);
    expect(actionKindEnabled("send")).toBe(false);
    expect(actionKindEnabled("admin")).toBe(false);

    process.env.MCP_WRITE_ENABLED = "true";
    process.env.MCP_DELETE_ENABLED = "true";
    expect(actionKindEnabled("write")).toBe(true);
    expect(actionKindEnabled("delete")).toBe(true);
    expect(actionKindEnabled("send")).toBe(false);
    expect(actionKindEnabled("admin")).toBe(false);
  });
});

describe("supportedScopes por tier", () => {
  it("apagado: solo lectura (credentials del CRM nunca entran)", () => {
    expect(supportedScopes()).toEqual([...MCP_READ_SCOPES]);
  });

  it("encendido: agrega los scopes de ese tier", () => {
    process.env.MCP_WRITE_ENABLED = "true";
    expect(supportedScopes()).toContain("crm.contacts.write");
    expect(supportedScopes()).not.toContain("crm.contacts.delete");

    process.env.MCP_DELETE_ENABLED = "true";
    expect(supportedScopes()).toEqual(expect.arrayContaining([...MCP_DELETE_SCOPES]));
    expect(supportedScopes()).not.toContain("crm.messages.send");

    process.env.MCP_SEND_ENABLED = "true";
    expect(supportedScopes()).toEqual(
      expect.arrayContaining(["crm.messages.send", "crm.quotes.send", "crm.email.send"])
    );
    expect(supportedScopes()).not.toContain("crm.audit.read");
  });

  it("el tier admin agrega crm.audit.read solo con MCP_ADMIN_ENABLED", () => {
    expect(supportedScopes()).not.toContain("crm.audit.read");
    expect(() => normalizeScopes("crm.audit.read")).toThrow(/Unsupported MCP scope/);

    process.env.MCP_ADMIN_ENABLED = "true";
    expect(supportedScopes()).toContain("crm.audit.read");
    expect(normalizeScopes("crm.audit.read")).toEqual(["crm.audit.read"]);
  });

  it("crm.settings.read siempre está en los scopes de lectura", () => {
    expect(MCP_READ_SCOPES).toContain("crm.settings.read");
    expect(supportedScopes()).toContain("crm.settings.read");
  });

  it("acepta el scope de borrado solo con el tier de borrado", () => {
    expect(() => normalizeScopes("crm.contacts.delete")).toThrow(/Unsupported MCP scope/);
    process.env.MCP_DELETE_ENABLED = "true";
    expect(normalizeScopes("crm.contacts.delete")).toEqual(["crm.contacts.delete"]);
  });
});
