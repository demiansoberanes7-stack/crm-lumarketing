import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAgentProfile } from "@/app/api/agent/profile/route";
import { GET as getKnowledgeBase } from "@/app/api/kb/route";
import { GET as getAutomationRules } from "@/app/api/automations/rules/route";
import { GET as getIntegration } from "@/app/api/integrations/[provider]/route";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  getDb: vi.fn(),
  diagnostic: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/session")>(),
  requireSession: mocks.session,
}));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/server/diagnostics/logger", () => ({ recordDiagnostic: mocks.diagnostic }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId: "member-a", organizationId: "org-a", role: "member" });
});

describe("configuración global restringida al owner", () => {
  it("bloquea Agente, base de conocimiento, automatizaciones e integraciones antes de acceder a datos", async () => {
    const responses = await Promise.all([
      getAgentProfile(),
      getKnowledgeBase(),
      getAutomationRules(),
      getIntegration(new Request("http://localhost/api/integrations/meta_ads"), {
        params: Promise.resolve({ provider: "meta_ads" }),
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
