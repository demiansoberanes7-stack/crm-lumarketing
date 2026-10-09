import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    META_GRAPH_BASE_URL: "https://graph.facebook.com/",
    META_GRAPH_API_VERSION: "v25.0",
  }),
}));

import { testMetaAdsConnection } from "@/server/integrations/test-connection";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("testMetaAdsConnection", () => {
  it("usa la versión centralizada de Graph y normaliza el ID de cuenta", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ name: "Cuenta de prueba", account_status: 1, currency: "MXN" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await testMetaAdsConnection({
      accessToken: "token-secreto",
      adAccountId: "123456789",
    });

    expect(result.status).toBe("connected");
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/v25.0/act_123456789");
    expect(requestUrl.searchParams.get("access_token")).toBe("token-secreto");
  });

  it("muestra code, subcode y fbtrace_id sin filtrar el access token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            message: "API access blocked.",
            type: "OAuthException",
            code: 200,
            error_subcode: 123456,
            fbtrace_id: "trace-public-reference",
          },
        },
        { status: 403 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await testMetaAdsConnection({
      accessToken: "token-secreto",
      adAccountId: "act_123456789",
    });

    expect(result.status).toBe("error");
    expect(result.message).toContain("API access blocked.");
    expect(result.message).toContain("code 200");
    expect(result.message).toContain("subcode 123456");
    expect(result.message).toContain("fbtrace_id trace-public-reference");
    expect(result.message).not.toContain("token-secreto");
  });
});
