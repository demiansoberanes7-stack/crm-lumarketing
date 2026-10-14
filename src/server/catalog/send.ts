import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { renderProductShare } from "@/server/ai/product-card";

/**
 * Envía la ficha de un producto (sin la cantidad de piezas) a una conversación.
 *
 * El canal lo dicta la conversación destino, igual que al enviar una cotización:
 * en canales con adjuntos podría ir un archivo, pero aquí siempre sale TEXTO
 * (≤1000 bytes en Instagram), que es lo único que todos los canales admiten.
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
  const result = await sendText({ organizationId, conversationId, text });
  return { messageId: result.messageId };
}
