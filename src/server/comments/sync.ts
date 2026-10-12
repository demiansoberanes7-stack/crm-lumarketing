import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getOrCreateContactByIdentity } from "@/server/inbox/identity";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { publish } from "@/server/events/bus";
import { getInstagramCredentialsByOrg } from "@/server/instagram/credentials";
import { getMessengerCredentialsByOrg } from "@/server/messenger/credentials";
import {
  fetchInstagramComments,
  fetchMessengerComments,
  type RawSocialComment,
} from "@/server/comments/fetch";

/**
 * Sync de comentarios de publicaciones (Instagram / página de Facebook) hacia
 * la Bandeja como canal `comments`.
 *
 * Idempotencia (constitución IV): `external_comment_id` es UNIQUE por org; el
 * upsert es por ese campo y el mensaje entrante usa un id derivado del
 * comentario como `wa_message_id`, así que un segundo poller no duplica nada.
 *
 * Una hebra POR AUTOR/POST: la identidad del contacto es
 * `{igc|fbc}:{postExternalId}:{authorExternalId}`, así que todos los comentarios
 * de un mismo autor sobre un mismo post caen en una sola conversación.
 */

export type SyncResult = { comments: number; newComments: number };

/** Prefijo de la identidad y del mensaje entrante según la plataforma. */
function platformBits(platform: "instagram" | "messenger") {
  return platform === "instagram"
    ? { prefix: "igc", channel: "comments" as const }
    : { prefix: "fbc", channel: "comments" as const };
}

function commentIdentity(platform: "instagram" | "messenger", c: RawSocialComment): string {
  return `${platformBits(platform).prefix}:${c.postExternalId}:${c.authorExternalId}`;
}

/** Texto del mensaje entrante en la Bandeja: cuerpo del comentario. */
export function commentMessageText(c: RawSocialComment): string {
  const header = c.postCaption
    ? `sobre: ${c.postCaption.slice(0, 120)}${c.postCaption.length > 120 ? "…" : ""}`
    : null;
  return header ? `${header}\n\n${c.body}` : c.body;
}

/**
 * Upsert del comentario + su ingest en la Bandeja. Devuelve true si el
 * comentario era NUEVO (para contar `newComments`).
 */
async function upsertCommentIntoInbox(input: {
  organizationId: string;
  platform: "instagram" | "messenger";
  comment: RawSocialComment;
}): Promise<boolean> {
  const db = getDb();
  const { organizationId, platform, comment } = input;

  const existing = await db
    .select({ id: schema.socialComment.id })
    .from(schema.socialComment)
    .where(
      and(
        eq(schema.socialComment.organizationId, organizationId),
        eq(schema.socialComment.externalCommentId, comment.externalCommentId)
      )
    )
    .limit(1);

  const isNew = !existing[0];
  if (isNew) {
    await db.insert(schema.socialComment).values({
      id: newId("socialComment"),
      organizationId,
      platform,
      externalCommentId: comment.externalCommentId,
      postExternalId: comment.postExternalId,
      postCaption: comment.postCaption,
      authorExternalId: comment.authorExternalId,
      authorName: comment.authorName,
      body: comment.body,
      parentExternalId: comment.parentExternalId,
      commentTime: comment.commentTime,
    });
  }

  // ── Ingest en la Bandeja (solo comentarios nuevos) ──
  if (!isNew) return false;

  const identity = commentIdentity(platform, comment);
  const { contact } = await getOrCreateContactByIdentity(organizationId, {
    identity,
    channel: platformBits(platform).channel,
    phone: null,
    waUserId: null,
    profileName: comment.authorName ?? null,
  });
  const conversation = await getOrCreateConversation(organizationId, contact.id, {
    channel: "comments",
    // threadRef = plataforma:post (estable por hebra); el send path lo usa para
    // ubicar el comentario al que responder.
    threadRef: `${platform === "instagram" ? "ig" : "fb"}:${comment.postExternalId}`,
  });

  // Los comentarios se responden a mano: el reply es PÚBLICO y el agente nunca
  // debe publicar solo. Si quedó aiEnabled (default de la tabla), se apaga.
  if (conversation.aiEnabled) {
    await db
      .update(schema.conversation)
      .set({ aiEnabled: false, updatedAt: new Date() })
      .where(eq(schema.conversation.id, conversation.id));
    conversation.aiEnabled = false;
  }

  const waMessageId = `${platformBits(platform).prefix}_${comment.externalCommentId.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      waMessageId,
      provider: platform,
      providerMessageId: comment.externalCommentId,
      direction: "in",
      type: "text",
      text: commentMessageText(comment),
      status: "delivered",
      waTimestamp: comment.commentTime,
    })
    .onConflictDoNothing({ target: [schema.message.waMessageId] })
    .returning({ id: schema.message.id });

  if (inserted[0]) {
    await db
      .update(schema.conversation)
      .set({
        lastInboundAt: comment.commentTime,
        lastMessageAt: comment.commentTime,
        unreadCount: (conversation.unreadCount ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.conversation.id, conversation.id));
    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: conversation.id } },
    });
  }

  return true;
}

async function syncPlatform(
  organizationId: string,
  platform: "instagram" | "messenger",
  fetched: { comments: RawSocialComment[] } | { error: string }
): Promise<SyncResult | { error: string }> {
  if ("error" in fetched) return { error: fetched.error };
  let newComments = 0;
  for (const comment of fetched.comments) {
    try {
      const created = await upsertCommentIntoInbox({ organizationId, platform, comment });
      if (created) newComments += 1;
    } catch (err) {
      console.error("[comments] comentario no ingerido:", comment.externalCommentId, err);
    }
  }
  return { comments: fetched.comments.length, newComments };
}

/** Sync completa de una organización: Instagram + Messenger. Nunca lanza. */
export async function syncOrganizationComments(
  organizationId: string
): Promise<SyncResult | { error: string }> {
  const [igCreds, msCreds] = await Promise.all([
    getInstagramCredentialsByOrg(organizationId),
    getMessengerCredentialsByOrg(organizationId),
  ]);

  const ig = igCreds ? await syncPlatform(organizationId, "instagram", await fetchInstagramComments(igCreds)) : null;
  const ms = msCreds ? await syncPlatform(organizationId, "messenger", await fetchMessengerComments(msCreds)) : null;

  if (!ig && !ms) return { error: "Sin cuenta de Instagram ni de Messenger conectadas vía Meta" };

  const errors: string[] = [];
  if (ig && "error" in ig) errors.push(`Instagram: ${ig.error}`);
  if (ms && "error" in ms) errors.push(`Messenger: ${ms.error}`);

  const igCount = ig && !("error" in ig) ? ig : { comments: 0, newComments: 0 };
  const msCount = ms && !("error" in ms) ? ms : { comments: 0, newComments: 0 };
  const total: SyncResult = {
    comments: igCount.comments + msCount.comments,
    newComments: igCount.newComments + msCount.newComments,
  };

  // Si ambas plataformas fallaron, reporta el error; si al menos una funcionó,
  // devuelve el conteo (el fallo parcial no esconde lo sincronizado).
  if (errors.length === (ig ? 1 : 0) + (ms ? 1 : 0) && total.comments === 0) {
    return { error: errors.join(" · ") };
  }
  return total;
}
