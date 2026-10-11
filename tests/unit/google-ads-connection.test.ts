import { afterEach, describe, expect, it, vi } from "vitest";
import { testGoogleAdsConnection } from "@/server/integrations/test-connection";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const CREDS = {
  customerId: "123-456-7890",
  developerToken: "dev-token-123",
  clientId: "client-id-abc",
  clientSecret: "client-secret-xyz",
};

describe("testGoogleAdsConnection con refresh token (OAuth real)", () => {
  it("intercambia el refresh token y confirma acceso real vía listAccessibleCustomers", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "access-token-123", expires_in: 3599 });
      }
      if (url.includes("customers:listAccessibleCustomers")) {
        return Response.json({ resourceNames: ["customers/1234567890"] });
      }
      return Response.json({ message: "inesperado" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await testGoogleAdsConnection({ ...CREDS, refreshToken: "1//0g-refresh" });
    expect(result.status).toBe("connected");
    expect(result.message).toContain("1 cuenta");

    const listCall = fetchMock.mock.calls.find(([u]) => String(u).includes("listAccessibleCustomers"));
    expect(listCall).toBeTruthy();
    const headers = listCall?.[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer access-token-123");
    expect(headers["developer-token"]).toBe("dev-token-123");
  });

  it("invalid_grant del refresh token se explica como acceso revocado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ error: "invalid_grant" }, { status: 400 })
    ));
    const result = await testGoogleAdsConnection({ ...CREDS, refreshToken: "revocado" });
    expect(result.status).toBe("error");
    expect(result.message).toContain("invalid_grant");
    expect(result.message).toContain("revocó");
  });

  it("sin refresh token conserva el sondeo legado (saved)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ error: "invalid_grant" }, { status: 400 })
    ));
    const result = await testGoogleAdsConnection(CREDS);
    expect(result.status).toBe("saved");
  });

  it("rechaza Customer ID que no sean 10 dígitos", async () => {
    const result = await testGoogleAdsConnection({ ...CREDS, customerId: "no-numero" });
    expect(result.status).toBe("error");
    expect(result.message).toContain("10 dígitos");
  });
});
