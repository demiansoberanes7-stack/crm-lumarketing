import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/agent/profile/route";
import { DEFAULT_AGENT_FICHA_FIELDS, DEFAULT_AGENT_RULES } from "@/lib/agent-config";

/**
 * Contrato de `disabledChannels` en Ajustes → Agente:
 * el GET entrega la lista normalizada y los canales de la instancia; el PUT
 * normaliza antes de guardar y rechaza canales que no existen.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getAiDbToken: vi.fn(),
  isAiConfigured: vi.fn(),
  enabledChannels: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class extends Error {},
  requireSession: async () => ({
    userId: "usr_1",
    organizationId: "org_1",
    role: "owner",
  }),
  getSessionOrNull: async () => null,
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));

vi.mock("@/server/diagnostics/logger", () => ({
  recordDiagnostic: vi.fn(async () => {}),
}));

vi.mock("@/server/ai/credentials", () => ({
  getAiDbToken: mocks.getAiDbToken,
}));

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isAiConfigured: mocks.isAiConfigured,
}));

vi.mock("@/server/channels/enabled", () => ({
  enabledChannels: mocks.enabledChannels,
}));

const state = {
  rows: [] as unknown[],
  updates: [] as Record<string, unknown>[],
};

const db = {
  select: () => {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(state.rows),
    };
    return chain;
  },
  update: () => ({
    set: (patch: Record<string, unknown>) => ({
      where: () => {
        state.updates.push(patch);
        return Promise.resolve([]);
      },
    }),
  }),
};

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    name: "Sofi",
    tone: null,
    instructions: null,
    escalationRules: null,
    greeting: null,
    pipelineKeywords: null,
    fichaFields: DEFAULT_AGENT_FICHA_FIELDS,
    rules: DEFAULT_AGENT_RULES,
    maxResponseWaitSeconds: 0,
    responseLanguage: "auto",
    fallbackLanguage: "es",
    reactWithEmoji: false,
    activeInNewConversations: true,
    disabledChannels: [],
    businessIndustry: null,
    businessLocation: null,
    businessDescription: null,
    ...overrides,
  };
}

function put(body: unknown): Request {
  return new Request("http://localhost/api/agent/profile", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [profileRow()];
  state.updates = [];
  mocks.getDb.mockReturnValue(db);
  mocks.getAiDbToken.mockResolvedValue(null);
  mocks.isAiConfigured.mockReturnValue(true);
  mocks.enabledChannels.mockReturnValue(new Set(["whatsapp", "instagram"]));
});

describe("GET /api/agent/profile", () => {
  it("normaliza la lista y expone sólo los canales encendidos de la instancia", async () => {
    state.rows = [
      profileRow({ disabledChannels: ["tiktok", "telegram", 7, "tiktok"] }),
    ];
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.profile.disabledChannels).toEqual(["tiktok"]);
    expect(body.channels).toEqual(["whatsapp", "instagram"]);
  });

  it("una columna nula (instalaciones previas) equivale a todos encendidos", async () => {
    state.rows = [profileRow({ disabledChannels: null })];
    const response = await GET();
    const body = await response.json();
    expect(body.profile.disabledChannels).toEqual([]);
  });
});

describe("PUT /api/agent/profile", () => {
  it("guarda la lista normalizada (orden de la Bandeja y sin duplicados)", async () => {
    const response = await PUT(
      put({ disabledChannels: ["mercado_libre", "tiktok", "tiktok"] })
    );
    expect(response.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.disabledChannels).toEqual([
      "tiktok",
      "mercado_libre",
    ]);
  });

  it("rechaza canales que no existen sin tocar la BD", async () => {
    const response = await PUT(put({ disabledChannels: ["telegram"] }));
    expect(response.status).toBe(422);
    expect(state.updates).toHaveLength(0);
  });
});
