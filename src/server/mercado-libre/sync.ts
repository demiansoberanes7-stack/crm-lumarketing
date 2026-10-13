import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getOrCreateContactByIdentity } from "@/server/inbox/identity";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { publish } from "@/server/events/bus";
import { recordDiagnostic } from "@/server/diagnostics/logger";
import {
  listPackMessages,
  listUnreadPacks,
  refreshAccessToken,
  type MlMessage,
} from "@/server/mercado-libre/client";
import {
  getMarketplaceCredentials,
  markMarketplaceError,
  markMarketplacePolled,
  saveMarketplaceAccessToken,
  saveMarketplaceRefreshToken,
  type MarketplaceCreds,
} from "@/server/mercado-libre/credentials";

/**
 * Sync de Mercado Libre: lista los packs con mensajes sin leer, trae el
 * historial de cada pack y ingerme los mensajes entrantes en la Bandeja como
 * canal `mercado_libre`.
 *
 * Idempotencia (constitución IV): `wa_message_id` guarda el id del mensaje de
 * la API (`mlmsg_<id>`, UNIQUE por org), así que un segundo poller no duplica
 * nada. Solo se ingeren mensajes del COMPRADOR (los salientes ya se persisten
 * al enviar).
 */

export type SyncResult = {
  packs: number;
  messages: number;
  newMessages: number;
};

/** Texto visible en la Bandeja: cuerpo del mensaje + marca de adjunto. */
export function mlMessageText(msg: MlMessage): string {
  const body = msg.text?.trim() || "";
  const attachments =
    msg.attachments.length > 0
      ? `\n\n[Adjunto: ${msg.attachments.join(", ")}]`
      : "";
  return `${body}${attachments}`.trim();
}

/**
 * Garantiza un access token vigente: si no hay o expira en menos de 60 s,
 * refresca y persiste (token cifrado + refresh token rotado si ML lo devolvió).
 */
export async function ensureMarketplaceAccessToken(
  organizationId: string,
  creds: MarketplaceCreds
): Promise<{ accessToken: string } | { error: string; authError: boolean }> {
  const stillValid =
    creds.accessToken &&
    creds.accessTokenExpiresAt &&
    creds.accessTokenExpiresAt.getTime() > Date.now() + 60_000;
  if (stillValid && creds.accessToken) return { accessToken: creds.accessToken };

  const refreshed = await refreshAccessToken(creds);
  if ("error" in refreshed) return refreshed;
  await saveMarketplaceAccessToken(organizationId, refreshed.token.accessToken, refreshed.token.expiresIn);
  if (refreshed.token.refreshToken && refreshed.token.refreshToken !== creds.refreshToken) {
    await saveMarketplaceRefreshToken(organizationId, refreshed.token.refreshToken);
  }
  return { accessToken: refreshed.token.accessToken };
}

async function ingestPackMessages(input: {
  organizationId: string;
  sellerUserId: string | null;
  packId: string;
  messages: MlMessage[];
}): Promise<{ ingested: number }> {
  const db = getDb();
  const { organizationId, sellerUserId, packId, messages } = input;
  let ingested = 0;

  for (const msg of messages) {
    // Solo el comprador: lo saliente ya se persiste en el momento del envío.
    const sellerIdNum = sellerUserId != null ? Number(sellerUserId) : Number.NaN;
    if (Number.isFinite(sellerIdNum) && msg.from.user_id === sellerIdNum) continue;
    // Un mensaje sin cuerpo y sin adjuntos no aporta nada al hilo.
    if (!msg.text?.trim() && msg.attachments.length === 0) continue;

    // Un pack es un hilo por COMPRADOR: la identidad estable es el user_id
    // del comprador (no el pack, que puede repetirse entre órdenes del mismo).
    const buyerIdentity = `ml:${msg.from.user_id}`;
    const { contact } = await getOrCreateContactByIdentity(organizationId, {
      identity: buyerIdentity,
      channel: "mercado_libre",
      phone: null,
      waUserId: null,
      profileName: msg.from.name ?? `Comprador ${msg.from.user_id}`,
    });
    const conversation = await getOrCreateConversation(organizationId, contact.id, {
      channel: "mercado_libre",
      threadRef: packId,
    });

    const waMessageId = `mlmsg_${msg.id}`;
    const timestamp = msg.date ? new Date(msg.date) : new Date();
    const inserted = await db
      .insert(schema.message)
      .values({
        id: newId("message"),
        organizationId,
        conversationId: conversation.id,
        waMessageId,
        provider: "mercado_libre",
        providerMessageId: msg.id,
        direction: "in",
        type: "text",
        text: mlMessageText(msg),
        status: "delivered",
        waTimestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
      })
      .onConflictDoNothing({ target: [schema.message.waMessageId] })
      .returning({ id: schema.message.id });

    if (inserted[0]) {
      ingested += 1;
      const at = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
      await db
        .update(schema.conversation)
        .set({
          lastInboundAt: at,
          lastMessageAt: at,
          unreadCount: (conversation.unreadCount ?? 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(schema.conversation.id, conversation.id));
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversation.id } },
      });
    }
  }

  return { ingested };
}

/**
 * Sync completa de una organización: packs pendientes → mensajes → Bandeja.
 * Nunca lanza: los fallos quedan como `{ error }` o en diagnósticos.
 */
export async function syncOrganization(
  organizationId: string
): Promise<SyncResult | { error: string }> {
  const creds = await getMarketplaceCredentials(organizationId);
  if (!creds) return { error: "Sin credenciales de Mercado Libre" };

  const token = await ensureMarketplaceAccessToken(organizationId, creds);
  if ("error" in token) {
    if (token.authError) {
      await markMarketplaceError(organizationId);
    }
    await recordDiagnostic({
      organizationId,
      source: "mercado_libre",
      severity: "error",
      code: "connection_failed",
      metadata: { detail: token.error },
    });
    return { error: token.error };
  }

  const unread = await listUnreadPacks(token.accessToken);
  if ("error" in unread) {
    if (unread.authError) await markMarketplaceError(organizationId);
    return { error: unread.error };
  }

  let packCount = 0;
  let messageCount = 0;
  let newMessageCount = 0;

  for (const packId of unread.packIds) {
    const thread = await listPackMessages(token.accessToken, packId);
    if ("error" in thread) continue;
    packCount += 1;
    messageCount += thread.messages.length;
    try {
      const { ingested } = await ingestPackMessages({
        organizationId,
        sellerUserId: creds.userId,
        packId,
        messages: thread.messages,
      });
      newMessageCount += ingested;
    } catch (err) {
      console.error("[mercado-libre] pack no ingerido:", packId, err);
    }
  }

  await markMarketplacePolled(organizationId);
  return { packs: packCount, messages: messageCount, newMessages: newMessageCount };
}
