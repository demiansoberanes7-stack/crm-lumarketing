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
    disabledChannels: [],
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
    expect(text).not.toContain('"action":"search_inventory"');
    expect(text).not.toContain('"action":"move_stage"');
    expect(text).not.toContain("CAMPOS DISPONIBLES EN LA FICHA");
    expect(text).not.toContain("pide hablar con una persona");
    expect(text).not.toContain("única fuente de verdad");
  });

  it("mantiene los defaults existentes para las reglas de negocio", () => {
    const text = prompt();
    expect(text).toContain('"action":"send_quote"');
    expect(text).toContain('"action":"create_quote"');
    expect(text).toContain('"action":"search_inventory"');
    expect(text).toContain('"items":[{"item_id"');
    expect(text).toContain("Si el cliente solicita explícitamente una cotización");
    expect(text).toContain('"action":"move_stage"');
    expect(text).toContain("Si el cliente pide hablar con una persona");
    expect(text).toContain("no inventes");
  });

  it("no remite a search_inventory si la regla de catálogo está apagada", () => {
    const text = buildAgentSystemPrompt({
      profile: profile({ rules: { ...DEFAULT_AGENT_RULES, sendProductQuotes: false } }),
      kb: [],
      catalog: Array.from({ length: 61 }, (_, i) => ({
        id: `cat_${i}`,
        name: `Producto ${i}`,
        price: 10000,
        currency: "MXN",
        stock: 1,
        available: true,
        shortDescription: null,
        longDescription: null,
        websiteUrl: null,
      } as never)),
      stages: [{ name: "Interesado" }],
    });

    expect(text).toContain("solo aparecen 60");
    expect(text).not.toContain("search_inventory");
  });
});

/**
 * Auditoría de Ajustes → Agente: cada campo de la tarjeta tiene que llegar al
 * prompt y pesar más que las reglas generales.
 */
describe("prompt del agente según la configuración guardada", () => {
  function built(
    agentProfile: AgentProfile,
    extra: Partial<Parameters<typeof buildAgentSystemPrompt>[0]> = {}
  ) {
    return buildAgentSystemPrompt({
      profile: agentProfile,
      kb: [],
      catalog: [],
      stages: [{ name: "Interesado" }],
      ...extra,
    });
  }

  it("«automático» deja de ser español forzado: el respaldo solo cubre la duda", () => {
    const text = built(profile({ responseLanguage: "auto", fallbackLanguage: "es" }));
    expect(text).toContain("Respondes en el idioma en que te escribe el cliente");
    expect(text).not.toContain("Respondes SIEMPRE en español neutro");
  });

  it("el idioma fijo sigue siendo fijo", () => {
    expect(built(profile({ responseLanguage: "en" }))).toContain(
      "You are ALWAYS responding in English"
    );
  });

  it("manda el contrato de formato del mensaje, con negrita solo en WhatsApp", () => {
    const wa = built(profile(), { channel: "whatsapp" });
    expect(wa).toContain("FORMATO DEL MENSAJE");
    expect(wa).toContain("un elemento por renglón");
    expect(wa).toContain("usa *asteriscos*");

    const ig = built(profile(), { channel: "instagram" });
    expect(ig).toContain("Escribe en texto plano");
    expect(ig).not.toContain("usa *asteriscos*");
  });

  it("las instrucciones del negocio se declaran por encima de las reglas generales", () => {
    const text = built(profile({ instructions: "Nunca ofrezcas descuentos." }));
    expect(text).toContain("JERARQUÍA: las Instrucciones del negocio");
    expect(text.indexOf("Nunca ofrezcas descuentos.") <
      text.indexOf("En cada turno respondes ÚNICAMENTE")).toBe(true);
  });

  it("usa el nombre de Datos de Empresa para presentarse", () => {
    expect(built(profile(), { businessName: "Celularite" })).toContain(
      'de Celularite. '
    );
    expect(built(profile())).toContain("de este negocio");
  });

  it("con agenda encendida conoce el horario real del negocio", () => {
    const text = built(profile(), {
      agenda: true,
      businessHours: {
        weeklyHours: {
          mon: [{ start: "09:00", end: "18:00" }],
          tue: [{ start: "09:00", end: "14:00" }],
        },
        timezone: "America/Mexico_City",
        slotMinutes: 30,
        bufferMinutes: 15,
        minNoticeHours: 2,
        maxDaysAhead: 7,
      },
    });
    expect(text).toContain("lun 09:00-18:00, mar 09:00-14:00");
    expect(text).toContain("cerrado: mié, jue, vie, sáb, dom");
    expect(text).toContain("con 15 min entre citas");
    expect(text).toContain('"action":"offer_slots"');
  });

  it("sin agenda no habla de horarios ni ofrece acciones de cita", () => {
    const text = built(profile());
    expect(text).not.toContain("Horario de atención del negocio");
    expect(text).not.toContain("offer_slots");
  });

  it("la cotización sin IVA es una acción explícita, nunca un favor", () => {
    const text = built(profile());
    expect(text).toContain('"iva":false');
    expect(text).toContain("Si el cliente pide la cotización SIN IVA");
  });

  it("la agenda nunca encima citas y no cede ante la insistencia", () => {
    const text = built(profile(), { agenda: true });
    expect(text).toContain("El sistema jamás agenda dos citas encima");
  });
});
