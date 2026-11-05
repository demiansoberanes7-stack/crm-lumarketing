import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { channelLabel, supportsOutboundMedia } from "@/server/channels/capabilities";
import { renderProductShare } from "@/server/ai/product-card";

/**
 * Envía la ficha de un producto (sin la cantidad de piezas) a una conversación.
 *
 * El canal lo dicta la conversación destino, igual que al enviar una cotización:
 * la ficha siempre sale como TEXTO (≤1000 bytes en Instagram), que es lo único
 * que todos los canales admiten, y en los que sí aceptan adjuntos va además la
 * foto principal del producto.
 */
export async function sendProductToConversation(
  organizationId: string,
  productId: string,
  conversationId: string
): Promise<{ messageId?: string }> {
  const db = getDb();

  const [product] = await db
    .select()
    .from(schema.catalogProduct)
    .where(
      scoped(
        schema.catalogProduct.organizationId,
        organizationId,
        eq(schema.catalogProduct.id, productId)
      )
    )
    .limit(1);
  if (!product) throw new Error("Producto no encontrado");

  // El chat debe ser real (no de pruebas) y de esta organización.
  const [conversation] = await db
    .select()
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  if (!conversation) throw new Error("Ese chat no existe");

  const text = renderProductShare(product);
  const { sendText } = await import("@/server/inbox/send");
  // Ficha enviada manualmente desde el catálogo.
  const result = await sendText({
    organizationId,
    conversationId,
    text,
    humanAgentTagAllowed: true,
  });

  // La foto se manda DESPUÉS de la ficha y su fallo no revienta el envío: el
  // texto ya está en el chat, y `sendMediaMessage` deja el adjunto persistido
  // como `failed` para que el operador lo vea en el hilo.
  await sharePrimaryImage(organizationId, productId, conversation).catch((err) => {
    console.error(`[catalogo] no se pudo compartir la foto en ${conversationId}:`, err);
  });

  return { messageId: result.messageId };
}

async function sharePrimaryImage(
  organizationId: string,
  productId: string,
  conversation: typeof schema.conversation.$inferSelect
): Promise<void> {
  if (!supportsOutboundMedia(conversation.channel)) {
    console.info(
      `[catalogo] ficha compartida sin foto: ${channelLabel(conversation.channel)} no admite adjuntos`
    );
    return;
  }
  const { primaryImageFilesForChat } = await import("@/server/catalog/images");
  const { files, unreadable } = await primaryImageFilesForChat(organizationId, [productId]);
  if (unreadable.length > 0) {
    console.warn(`[catalogo] ficha compartida sin foto: su archivo ya no está en disco (${productId})`);
    return;
  }
  const photo = files[productId];
  if (!photo) return;
  const { sendMediaMessage } = await import("@/server/inbox/send");
  await sendMediaMessage({
    organizationId,
    conversationId: conversation.id,
    file: photo,
    humanAgentTagAllowed: true,
  });
}
