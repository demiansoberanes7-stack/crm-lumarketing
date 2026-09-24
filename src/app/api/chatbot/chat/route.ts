import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { chatJson, type ChatMessage } from "@/lib/ai";

export const dynamic = "force-dynamic";

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
});

/** Simple in-memory chat history per session (resets on deploy) */
const chatHistory = new Map<string, ChatMessage[]>();

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, chatSchema);
  if (!body.ok) return body.response;

  const env = getEnv();
  const apiKey = env.CHATBOT_API_TOKEN;
  const model = env.CHATBOT_MODEL;
  const baseUrl = env.CHATBOT_BASE_URL;

  if (!apiKey) {
    return Response.json(
      { error: { code: "not_configured", message: "CHATBOT_API_TOKEN no configurado" } },
      { status: 503 }
    );
  }

  const sessionId = session.organizationId;
  const history = chatHistory.get(sessionId) ?? [];

  const systemMessage: ChatMessage = {
    role: "system",
    content: `Eres un asistente interno del CRM. Puedes ayudar con:
- Consultar contactos, leads, pipeline, proyectos, cotizaciones, pagos, gastos
- Responder preguntas sobre datos del negocio
- Sugerir acciones dentro del sistema
Responde en espanol. Sé conciso y directo. Si no tienes acceso a datos específicos, indícalo.`,
  };

  const userMessage: ChatMessage = { role: "user", content: body.data.message };
  const messages = [systemMessage, ...history.slice(-20), userMessage];

  const result = await chatJson(
    z.object({ response: z.string() }),
    [
      ...messages.slice(0, -1),
      { role: "user", content: `${body.data.message}\n\nResponde con JSON: {"response": "tu respuesta"}` },
    ],
    { apiKey, model, baseUrl, timeoutMs: 30_000 }
  );

  if (!result.ok) {
    return Response.json(
      { error: { code: "ai_error", message: result.detail } },
      { status: 502 }
    );
  }

  const agentReply = result.data.response;
  history.push(userMessage, { role: "assistant", content: agentReply });
  if (history.length > 40) history.splice(0, history.length - 40);
  chatHistory.set(sessionId, history);

  return Response.json({
    response: agentReply,
    messages: [
      ...history.filter((m) => m.role !== "system").map((m) => ({
        role: m.role === "assistant" ? "agent" as const : "user" as const,
        text: m.content,
      })),
    ],
  });
});
