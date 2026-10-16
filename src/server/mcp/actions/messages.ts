import { z } from "zod";
import { isChannel } from "@/lib/channels";
import { serializeMessage } from "@/server/inbox/ingest";
import { listConversations, listMessages } from "@/server/inbox/queries";
import { sendText } from "@/server/inbox/send";
import { sendActionError } from "./send-errors";
import { defineAction } from "@/server/mcp/registry";

/** Forma cruda reutilizable por la herramienta nativa `send_message`. */
export const messagesSendShape = {
  conversationId: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(4096),
};

const messagesSend = z.object(messagesSendShape);

const conversationsList = z.object({
  channel: z
    .string()
    .refine((value) => isChannel(value), "Canal desconocido")
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const messagesList = z.object({
  conversationId: z.string().min(1).max(64),
  since: z.string().max(40).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const messagesActions = [
  defineAction({
    name: "conversations.list",
    domain: "inbox",
    kind: "read",
    scope: "crm.conversations.read",
    title: "Listar conversaciones",
    description:
      "Lista los chats reales (no de prueba) con contacto, canal, vista previa y etapa. Sirve para elegir el conversationId al enviar.",
    input: conversationsList,
    handler: async (principal, input) => {
      // El refine de zod garantiza el canal; aquí solo se estrecha el tipo.
      const channel =
        input.channel !== undefined && isChannel(input.channel) ? input.channel : undefined;
      const conversations = await listConversations(
        principal.organizationId,
        undefined,
        channel
      );
      const limited = conversations.slice(0, input.limit ?? 50);
      return {
        text: `Se encontraron ${limited.length} conversaciones.`,
        structuredContent: { count: limited.length, conversations: limited },
      };
    },
  }),

  defineAction({
    name: "messages.list",
    domain: "inbox",
    kind: "read",
    scope: "crm.conversations.read",
    title: "Listar mensajes de un chat",
    description: "Devuelve el hilo de mensajes de una conversación (opcionalmente desde una fecha).",
    input: messagesList,
    handler: async (principal, input) => {
      const since = input.since ? new Date(input.since) : undefined;
      const rows = await listMessages(
        principal.organizationId,
        input.conversationId,
        since && !Number.isNaN(since.getTime()) ? since : undefined
      );
      const limit = input.limit ?? 50;
      const limited = rows.slice(-limit);
      return {
        text: `Se encontraron ${limited.length} mensajes.`,
        structuredContent: {
          count: limited.length,
          messages: limited.map((row) => serializeMessage(row.message, row.media)),
        },
      };
    },
  }),

  defineAction({
    name: "messages.send",
    domain: "inbox",
    kind: "send",
    scope: "crm.messages.send",
    title: "Enviar mensaje al chat",
    description:
      "Envía un texto de hasta 4096 caracteres al chat de un contacto (WhatsApp, Instagram, Messenger u otro canal conectado). Respeta la ventana de respuesta y nunca toca conversaciones de prueba.",
    destructive: true,
    input: messagesSend,
    handler: async (principal, input) => {
      try {
        const result = await sendText({
          conversationId: input.conversationId,
          organizationId: principal.organizationId,
          text: input.text,
        });
        return {
          text: "Mensaje enviado.",
          structuredContent: { messageId: result.messageId, conversationId: input.conversationId },
        };
      } catch (err) {
        throw sendActionError(err);
      }
    },
  }),
];
