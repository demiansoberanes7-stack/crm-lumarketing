/**
 * DEPRECATED — Este archivo NO se usa. El envío WAHA se maneja directamente
 * en src/server/inbox/send.ts (línea 204+). Mantenido como referencia.
 * Puede eliminarse en una limpieza futura.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import {
  sendText as wahaSendText,
  sendFile as wahaSendFile,
  sendTemplate as wahaSendTemplate,
  typing as wahaTyping,
  clearTyping as wahaClearTyping,
  type WahaError,
} from "@/server/waha/client";
import { getWahaCredentialsFull } from "@/server/waha/credentials";

export class WahaSendError extends Error {
  code:
    | "not_connected"
    | "reconnect_required"
    | "window_closed"
    | "waha_error"
    | "upload_failed";
  messageId?: string;

  constructor(code: WahaSendError["code"], message: string) {
    super(message);
    this.name = "WahaSendError";
    this.code = code;
  }
}

type SendResult = { messageId: string };

/**
 * Verificar que la ventana de 24h esté abierta para un mensaje de texto libre.
 * Si está cerrada, solo se pueden enviar plantillas.
 */
function checkWindow(
  conversation: typeof schema.conversation.$inferSelect
): void {
  if (!isWindowOpen(conversation.lastInboundAt)) {
    throw new WahaSendError(
      "window_closed",
      "La ventana de 24h está cerrada. Usa una plantilla para contactar al cliente."
    );
  }
}

/**
 * Preparar chatId de WAHA desde phone normalizado.
 */
function chatIdFromPhone(phone: string): string {
  // WAHA usa formato: 521XXXXXXXXXX@s.whatsapp.net
  return `${phone}@s.whatsapp.net`;
}

/**
 * Enviar mensaje de texto por WAHA.
 */
export async function sendWahaText(input: {
  organizationId: string;
  conversationId: string;
  text: string;
  origin?: "ai" | "operator";
}): Promise<SendResult> {
  const creds = await getWahaCredentialsFull(input.organizationId);
  if (!creds) {
    throw new WahaSendError("not_connected", "WAHA no está conectado");
  }

  // Obtener conversación
  const db = getDb();

  // Buscar conversación completa
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(
      scoped(schema.conversation.organizationId, input.organizationId, eq(schema.conversation.id, input.conversationId))
    )
    .limit(1);

  const conversation = convRows[0];
  if (!conversation) {
    throw new WahaSendError("not_connected", "Conversación no encontrada");
  }

  // Obtener contacto para el phone
  const contactRows = await db
    .select()
    .from(schema.contact)
    .where(
      scoped(schema.contact.organizationId, input.organizationId, eq(schema.contact.id, conversation.contactId))
    )
    .limit(1);

  const contact = contactRows[0];
  if (!contact?.phone) {
    throw new WahaSendError("not_connected", "Contacto sin teléfono");
  }

  // Verificar ventana 24h
  checkWindow(conversation);

  try {
    const chatId = chatIdFromPhone(contact.phone);
    const result = await wahaSendText(
      creds.baseUrl,
      creds.apiKey,
      creds.sessionName,
      chatId,
      input.text
    );

    const waMessageId = result.key.id;

    // Persistir mensaje saliente
    const messageId = newId("message");
    await db.insert(schema.message).values({
      id: messageId,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId,
      direction: "out",
      type: "text",
      text: input.text,
      status: "sent",
      origin: input.origin ?? "operator",
    });

    // Actualizar conversación
    await db
      .update(schema.conversation)
      .set({
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        scoped(schema.conversation.organizationId, input.organizationId, eq(schema.conversation.id, input.conversationId))
      );

    // Publicar evento
    publish(input.organizationId, {
      type: "message.new",
      data: {
        conversationId: input.conversationId,
        message: {
          id: messageId,
          conversationId: input.conversationId,
          direction: "out",
          type: "text",
          text: input.text,
          status: "sent",
          origin: input.origin ?? "operator",
        },
      },
    });

    return { messageId };
  } catch (err) {
    if (err instanceof WahaSendError) throw err;
    const wahaErr = err as WahaError;
    throw new WahaSendError(
      "waha_error",
      `WAHA error: ${wahaErr.message}`
    );
  }
}

/**
 * Enviar plantilla por WAHA (para mensajes fuera de ventana).
 */
export async function sendWahaTemplate(input: {
  organizationId: string;
  conversationId: string;
  templateName: string;
  languageCode?: string;
  components?: unknown[];
}): Promise<SendResult> {
  const creds = await getWahaCredentialsFull(input.organizationId);
  if (!creds) {
    throw new WahaSendError("not_connected", "WAHA no está conectado");
  }

  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(
      scoped(schema.conversation.organizationId, input.organizationId, eq(schema.conversation.id, input.conversationId))
    )
    .limit(1);

  const conversation = convRows[0];
  if (!conversation) {
    throw new WahaSendError("not_connected", "Conversación no encontrada");
  }

  const contactRows = await db
    .select()
    .from(schema.contact)
    .where(
      scoped(schema.contact.organizationId, input.organizationId, eq(schema.contact.id, conversation.contactId))
    )
    .limit(1);

  const contact = contactRows[0];
  if (!contact?.phone) {
    throw new WahaSendError("not_connected", "Contacto sin teléfono");
  }

  try {
    const chatId = chatIdFromPhone(contact.phone);
    const result = await wahaSendTemplate(
      creds.baseUrl,
      creds.apiKey,
      creds.sessionName,
      chatId,
      {
        name: input.templateName,
        language: { code: input.languageCode ?? "es" },
        components: input.components,
      }
    );

    const waMessageId = result.key.id;

    const messageId = newId("message");
    await db.insert(schema.message).values({
      id: messageId,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId,
      direction: "out",
      type: "template",
      text: input.templateName,
      status: "sent",
      origin: "template",
    });

    await db
      .update(schema.conversation)
      .set({
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        scoped(schema.conversation.organizationId, input.organizationId, eq(schema.conversation.id, input.conversationId))
      );

    publish(input.organizationId, {
      type: "message.new",
      data: {
        conversationId: input.conversationId,
        message: {
          id: messageId,
          conversationId: input.conversationId,
          direction: "out",
          type: "template",
          text: input.templateName,
          status: "sent",
          origin: "template",
        },
      },
    });

    return { messageId };
  } catch (err) {
    if (err instanceof WahaSendError) throw err;
    const wahaErr = err as WahaError;
    throw new WahaSendError("waha_error", `WAHA error: ${wahaErr.message}`);
  }
}

/**
 * Enviar archivo por WAHA.
 */
export async function sendWahaFile(input: {
  organizationId: string;
  conversationId: string;
  file: { mimetype: string; url?: string; path?: string; caption?: string };
}): Promise<SendResult> {
  const creds = await getWahaCredentialsFull(input.organizationId);
  if (!creds) {
    throw new WahaSendError("not_connected", "WAHA no está conectado");
  }

  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(
      scoped(schema.conversation.organizationId, input.organizationId, eq(schema.conversation.id, input.conversationId))
    )
    .limit(1);

  const conversation = convRows[0];
  if (!conversation) {
    throw new WahaSendError("not_connected", "Conversación no encontrada");
  }

  checkWindow(conversation);

  const contactRows = await db
    .select()
    .from(schema.contact)
    .where(
      scoped(schema.contact.organizationId, input.organizationId, eq(schema.contact.id, conversation.contactId))
    )
    .limit(1);

  const contact = contactRows[0];
  if (!contact?.phone) {
    throw new WahaSendError("not_connected", "Contacto sin teléfono");
  }

  try {
    const chatId = chatIdFromPhone(contact.phone);
    const result = await wahaSendFile(
      creds.baseUrl,
      creds.apiKey,
      creds.sessionName,
      chatId,
      input.file
    );

    const waMessageId = result.key.id;

    const messageId = newId("message");
    await db.insert(schema.message).values({
      id: messageId,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId,
      direction: "out",
      type: "document",
      text: input.file.caption ?? null,
      status: "sent",
      origin: "operator",
    });

    await db
      .update(schema.conversation)
      .set({
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        scoped(schema.conversation.organizationId, input.organizationId, eq(schema.conversation.id, input.conversationId))
      );

    publish(input.organizationId, {
      type: "message.new",
      data: {
        conversationId: input.conversationId,
        message: {
          id: messageId,
          conversationId: input.conversationId,
          direction: "out",
          type: "document",
          text: input.file.caption,
          status: "sent",
          origin: "operator",
        },
      },
    });

    return { messageId };
  } catch (err) {
    if (err instanceof WahaSendError) throw err;
    const wahaErr = err as WahaError;
    throw new WahaSendError("waha_error", `WAHA error: ${wahaErr.message}`);
  }
}

/**
 * Mostrar "escribiendo…" en WAHA.
 */
export async function showTyping(
  organizationId: string,
  phone: string
): Promise<void> {
  const creds = await getWahaCredentialsFull(organizationId);
  if (!creds) return;
  await wahaTyping(
    creds.baseUrl,
    creds.apiKey,
    creds.sessionName,
    chatIdFromPhone(phone)
  ).catch(() => {});
}

/**
 * Detener "escribiendo…"
 */
export async function hideTyping(
  organizationId: string,
  phone: string
): Promise<void> {
  const creds = await getWahaCredentialsFull(organizationId);
  if (!creds) return;
  await wahaClearTyping(
    creds.baseUrl,
    creds.apiKey,
    creds.sessionName,
    chatIdFromPhone(phone)
  ).catch(() => {});
}
