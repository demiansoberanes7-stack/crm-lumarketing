import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_FICHA_FIELDS, DEFAULT_AGENT_RULES } from "@/lib/agent-config";

/**
 * Los dos interruptores de Ajustes → Agente → Respuesta que no hacían nada.
 *
 * `activeInNewConversations` y `reactWithEmoji` se guardaban en la BD, se
 * leían en el GET y salían en la tarjeta, pero ningún punto de ejecución los
 * consultaba: mover la palanca no cambiaba el comportamiento del bot. Aquí se
 * fija que el turno los obedece.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  chatJson: vi.fn(),
  resolveAiConfig: vi.fn(),
  isAiConfigured: vi.fn(),
  sendText: vi.fn(),
  reactToInbound: vi.fn(),
  publish: vi.fn(),
}));

const selectQueue: unknown[][] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
    chain[method] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const db = {
  select: () => thenableChain(selectQueue.shift() ?? []),
  insert: () => ({ values: () => Promise.resolve(undefined) }),
  update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/lib/ai", () => ({
  chatJson: mocks.chatJson,
  resolveAiConfig: mocks.resolveAiConfig,
  isAiConfigured: mocks.isAiConfigured,
}));
vi.mock("@/server/inbox/send", () => ({
  SendError: class SendError extends Error { code = "send_failed"; },
  sendText: mocks.sendText,
  reactToInbound: mocks.reactToInbound,
}));
vi.mock("@/server/events/bus", () => ({ publish: mocks.publish }));
vi.mock("@/server/agenda/flag", () => ({ agendaEnabled: () => false }));

const inboundAt = new Date();

/**
 * @param newestFirst las filas de `message` en el orden que devuelve la BD (reciente primero).
 * @param atendidaPorHumano qué responde la búsqueda de "¿ya habló alguien de carne y hueso
 *        esta conversación?". Solo se consulta con el interruptor apagado.
 */
function queueTurn(
  profilePatch: Record<string, unknown>,
  newestFirst: unknown[],
  atendidaPorHumano = false,
  /** La búsqueda de "¿ya respondió alguien?" que hace el turno cuando el modelo calla. */
  yaAtendida: unknown[] = [],
  isTest = false
) {
  const gate = profilePatch.activeInNewConversations === false;
  selectQueue.push(
    [{ id: "cv_1", organizationId: "org_1", contactId: "ct_1", channel: "whatsapp", isTest, aiEnabled: true, handoffAt: null, handoffReason: null, lastInboundAt: inboundAt }],
    [{
      id: "agp_1",
      organizationId: "org_1",
      enabled: true,
      name: "Sofi",
      rules: DEFAULT_AGENT_RULES,
      fichaFields: DEFAULT_AGENT_FICHA_FIELDS,
      maxResponseWaitSeconds: 0,
      // Como en la BD: `active_in_new_conversations` arranca en true.
      activeInNewConversations: true,
      reactWithEmoji: false,
      ...profilePatch,
    }],
    newestFirst,
    ...(gate ? [atendidaPorHumano ? [{ id: "msg_humano" }] : []] : []),
    [], // base de conocimiento
    [], // catálogo
    [], // etapas del pipeline
    [], // datos de empresa (el nombre va ahora en el system prompt)
    yaAtendida
  );
}

const mensajeCliente = { id: "msg_1", direction: "in", text: "Hola, ¿tienen espacio?", waMessageId: "WA-1", createdAt: inboundAt };

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue.length = 0;
  mocks.getDb.mockReturnValue(db);
  mocks.resolveAiConfig.mockResolvedValue({ token: "test-token", model: "test-model" });
  mocks.isAiConfigured.mockReturnValue(true);
  mocks.chatJson.mockResolvedValue({ ok: true, data: { action: "reply", text: "¡Hola! Sí, tenemos espacio." } });
  mocks.sendText.mockResolvedValue({ messageId: "m_out" });
  mocks.reactToInbound.mockResolvedValue(undefined);
});

describe("activo en conversaciones nuevas", () => {
  it("encendido (el default de la BD): el agente abre la conversación nueva", async () => {
    queueTurn({}, [mensajeCliente]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "cv_1", aiGenerated: true })
    );
  });

  it("apagado, la primera llegada queda para un humano: ni LLM ni respuesta", async () => {
    queueTurn({ activeInNewConversations: false }, [mensajeCliente]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.chatJson).not.toHaveBeenCalled();
    expect(mocks.sendText).not.toHaveBeenCalled();
  });

  it("apagado NO amordaza una conversación que ya atendió una persona", async () => {
    // Ojo: el historial de la ventana SOLO trae el mensaje del cliente. Lo que
    // desbloquea al agente es la búsqueda en toda la conversación, no la ventana
    // de 20 —en un chat largo abierto por un humano el saludo viejo ya no cabe.
    queueTurn({ activeInNewConversations: false }, [mensajeCliente], true);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "cv_1" })
    );
  });
});

describe("el modelo decide no responder (action: none)", () => {
  /**
   * «Prueba 1», «hola» suelto, un emoji: el LLM devuelve `none` y el cliente no
   * recibe NADA. En un negocio recién creado eso se lee como "la IA no
   * contesta", y en producción no quedaba ni un rastro del silencio.
   */
  beforeEach(() => {
    mocks.chatJson.mockResolvedValue({ ok: true, data: { action: "none" } });
  });

  it("saluda con la bienvenida del negocio si nadie ha respondido nunca", async () => {
    queueTurn({ greeting: "¡Hola! Somos Honeycat 🐱" }, [mensajeCliente]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "cv_1",
        text: "¡Hola! Somos Honeycat 🐱",
        aiGenerated: true,
      })
    );
  });

  it("usa un saludo genérico si el negocio no escribió bienvenida", async () => {
    queueTurn({ greeting: null }, [mensajeCliente]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Gracias por escribir") })
    );
  });

  it("respeta el silencio cuando la conversación ya fue atendida", async () => {
    queueTurn({ greeting: "¡Hola!" }, [mensajeCliente], false, [{ id: "msg_humano" }]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.sendText).not.toHaveBeenCalled();
  });
});

describe("reaccionar con emoji", () => {
  it("encendido: reacciona al mensaje del cliente con su id de WhatsApp", async () => {
    queueTurn({ reactWithEmoji: true }, [mensajeCliente]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.reactToInbound).toHaveBeenCalledWith({
      conversationId: "cv_1",
      organizationId: "org_1",
      messageId: "WA-1",
      emoji: "👍",
    });
  });

  it("apagado: no se reacciona nada", async () => {
    queueTurn({}, [mensajeCliente]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.reactToInbound).not.toHaveBeenCalled();
  });
});

describe("IA por canal (Ajustes → Agente)", () => {
  it("el canal apagado ni siquiera llama al modelo", async () => {
    queueTurn({ disabledChannels: ["whatsapp"] }, [mensajeCliente]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.chatJson).not.toHaveBeenCalled();
    expect(mocks.sendText).not.toHaveBeenCalled();
  });

  it("apagar TikTok no amordaza WhatsApp", async () => {
    queueTurn({ disabledChannels: ["tiktok"] }, [mensajeCliente]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "cv_1", aiGenerated: true })
    );
  });

  it("un valor corrupto o un canal desconocido no apaga nada", async () => {
    queueTurn({ disabledChannels: ["telegram", 7] }, [mensajeCliente]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.sendText).toHaveBeenCalled();
  });

  it("el Laboratorio evalúa aunque su canal esté apagado", async () => {
    queueTurn({ disabledChannels: ["whatsapp"] }, [mensajeCliente], false, [], true);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.chatJson).toHaveBeenCalled();
  });
});
