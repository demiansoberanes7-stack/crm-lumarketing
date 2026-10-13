import { describe, expect, it } from "vitest";
import type { schema } from "@/lib/db";
import { DEFAULT_AGENT_FICHA_FIELDS, DEFAULT_AGENT_RULES } from "@/lib/agent-config";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

type AgentProfile = typeof schema.agentProfile.$inferSelect;

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "agp_test",
    organizationId: "org_test",
    enabled: true,
    name: "Zorro",
    tone: null,
    instructions: null,
    escalationRules: null,
    greeting: null,
    pipelineKeywords: null,
    fichaFields: DEFAULT_AGENT_FICHA_FIELDS,
    rules: DEFAULT_AGENT_RULES,
    aiToken: null,
    aiTokenCipher: null,
    aiTokenIv: null,
    aiTokenTag: null,
    aiModel: null,
    maxResponseWaitSeconds: 12,
    responseLanguage: "auto",
    fallbackLanguage: "es",
    reactWithEmoji: false,
    activeInNewConversations: true,
    businessIndustry: null,
    businessLocation: null,
    businessDescription: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function prompt(agentProfile = profile()) {
  return buildAgentSystemPrompt({
    profile: agentProfile,
    kb: [],
    catalog: [],
    stages: [{ name: "Interesado" }, { name: "Ganado" }],
  });
}

describe("reglas y campos de ficha del prompt del agente", () => {
  it("inyecta las etiquetas y claves de ficha configuradas", () => {
    const text = prompt(profile({ fichaFields: [
      { key: "zona", label: "Zona de servicio" },
      { key: "presupuesto", label: "Presupuesto estimado" },
    ] }));

    expect(text).toContain("zona (Zona de servicio)");
    expect(text).toContain("presupuesto (Presupuesto estimado)");
    expect(text).toContain('"action":"update_lead"');
  });

  it("omite acciones y reglas desactivadas, preservando la configuración explícita", () => {
    const text = prompt(profile({
      rules: {
        captureLeadData: false,
        sendProductQuotes: false,
        handoffOnRequest: false,
        moveStageOnIntent: false,
        strictKnowledgeBase: false,
      },
    }));

    expect(text).not.toContain('"action":"send_quote"');
    expect(text).not.toContain('"action":"create_quote"');
    expect(text).not.toContain('"action":"move_stage"');
    expect(text).not.toContain("CAMPOS DISPONIBLES EN LA FICHA");
    expect(text).not.toContain("pide hablar con una persona");
    expect(text).not.toContain("única fuente de verdad");
  });

  it("mantiene los defaults existentes para las reglas de negocio", () => {
    const text = prompt();
    expect(text).toContain('"action":"send_quote"');
    expect(text).toContain('"action":"create_quote"');
    expect(text).toContain("Si el cliente solicita explícitamente una cotización");
    expect(text).toContain('"action":"move_stage"');
    expect(text).toContain("Si el cliente pide hablar con una persona");
    expect(text).toContain("no inventes");
  });
});
