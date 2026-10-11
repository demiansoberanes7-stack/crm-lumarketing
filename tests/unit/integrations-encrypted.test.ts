import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 0044 — Las credenciales de integraciones (Meta Ads, Google Ads, GA4,
 * reglas de automatización) se guardan cifradas con AES-256-GCM en un
 * triple cipher/iv/tag; el jsonb legado es solo fallback de lectura.
 */

const insertedRows: Record<string, unknown>[] = [];
const selectedRows: { queue: unknown[][] } = { queue: [] };

function builderFor(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit"]) {
    builder[m] = () => builder;
  }
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(rows);
  return builder;
}

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          insertedRows.push(v);
          return Promise.resolve();
        },
      }),
      update: () => ({
        set: () => ({ where: () => Promise.resolve() }),
      }),
      select: () => builderFor(selectedRows.queue.shift() ?? []),
      delete: () => ({ where: () => Promise.resolve() }),
    }),
  };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgres://root:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

describe("credenciales de integraciones (0044)", () => {
  it("saveIntegration guarda el triple cifrado y el jsonb queda vacío", async () => {
    const { saveIntegration } = await import("@/server/integrations");
    selectedRows.queue.push([]); // no existe → insert
    const credentials = { accessToken: "EAAB-token-secreto-meta", adAccountId: "act_123" };
    await saveIntegration("org_1", "meta_ads", credentials);

    const row = insertedRows[0]!;
    expect(JSON.stringify(row)).not.toContain("EAAB-token-secreto-meta");
    expect(row.credentials).toEqual({});
    expect(row.credentialsCipher).toBeTruthy();
    expect(row.credentialsIv).toBeTruthy();
    expect(row.credentialsTag).toBeTruthy();

    const { decryptSecret } = await import("@/lib/crypto");
    expect(
      JSON.parse(decryptSecret({
        cipher: row.credentialsCipher as string,
        iv: row.credentialsIv as string,
        tag: row.credentialsTag as string,
      }))
    ).toEqual(credentials);
  });

  it("getIntegration descifra el triple cuando existe", async () => {
    const { getIntegration } = await import("@/server/integrations");
    const { encryptSecret } = await import("@/lib/crypto");
    const credentials = { developerToken: "dev-token-secreto", customerId: "1234567890" };
    const encrypted = encryptSecret(JSON.stringify(credentials));

    selectedRows.queue.push([{
      id: "int_1",
      organizationId: "org_1",
      provider: "google_ads",
      credentials: {},
      credentialsCipher: encrypted.cipher,
      credentialsIv: encrypted.iv,
      credentialsTag: encrypted.tag,
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);
    const integration = await getIntegration("org_1", "google_ads");
    expect(integration?.credentials).toEqual(credentials);
  });

  it("getIntegration cae al jsonb legado sin triple (filas pre-0044)", async () => {
    const { getIntegration } = await import("@/server/integrations");
    selectedRows.queue.push([{
      id: "int_legacy",
      organizationId: "org_1",
      provider: "ga4",
      credentials: { propertyId: "properties/999", serviceAccountJson: "{}" },
      credentialsCipher: null,
      credentialsIv: null,
      credentialsTag: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);
    const integration = await getIntegration("org_1", "ga4");
    expect(integration?.credentials.propertyId).toBe("properties/999");
  });
});
