import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getOrCreateContactByIdentity } from "@/server/inbox/identity";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { publish } from "@/server/events/bus";
import { getInstagramCredentialsByOrg } from "@/server/instagram/credentials";
import { getMessengerCredentialsByOrg } from "@/server/messenger/credentials";
import { isChannelEnabled } from "@/server/channels/enabled";
import {
  fetchInstagramComments,
  fetchMessengerComments,
  fetchTikTokComments,
  type RawSocialComment,
} from "@/server/comments/fetch";
import type { TikTokCredentials } from "@/server/tiktok/credentials";
import { getTikTokCredentialsByOrg } from "@/server/tiktok/credentials";
import {
  COMMENT_IDENTITY_PREFIX,
  commentContactIdentity,
  type SocialCommentPlatform,
} from "@/lib/comment-thread";

export type { SocialCommentPlatform };

/**
 * Sync de comentarios de publicaciones (Instagram / Facebook / TikTok) hacia
 * la Bandeja como canal `comments`.
 *
 * Idempotencia (constitución IV): `external_comment_id` es UNIQUE por org; el
 * upsert es por ese campo y el mensaje entrante usa un id derivado del
 * comentario como `wa_message_id`, así que un segundo poller no duplica nada.
 *
 * Una hebra POR PERSONA: la identidad del contacto es `{igc|fbc|ttc}:{autor}`,
 * así que todos los comentarios de una persona caen en una sola conversación;
 * la publicación de cada comentario vive en `social_comment`. Los hilos viejos
 * (`prefijo:post:autor`) se agrupan en la lista con la misma llave.
 */

export type SyncResult = { comments: number; newComments: number };

/**
 * Upsert del comentario + su ingest en la Bandeja. Devuelve true si el
 * comentario era NUEVO (para contar `newComments`).
 */
async function upsertCommentIntoInbox(input: {
  organizationId: string;
  platform: SocialCommentPlatform;
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
      // La URL de la publicación no tiene columna propia: se guarda en `raw`
      // y el hilo la lee de ahí. Sin ella la tarjeta de la publicación queda
      // sin enlace, que es lo único opcional del contexto.
      raw: comment.postUrl ? { postUrl: comment.postUrl } : null,
      authorName: comment.authorName,
      body: comment.body,
      parentExternalId: comment.parentExternalId,
      commentTime: comment.commentTime,
    });
  }

  // ── Ingest en la Bandeja (solo comentarios nuevos) ──
  if (!isNew) return false;

  const identity = commentContactIdentity(platform, comment.authorExternalId);
  const { contact } = await getOrCreateContactByIdentity(organizationId, {
    identity,
    channel: "comments",
    phone: null,
    waUserId: null,
    profileName: comment.authorName ?? null,
  });
  // El hilo es de la persona: el post ya no encabeza la conversación. La
  // publicación de cada respuesta se resuelve en el envío desde el último
  // comentario de este autor en `social_comment`.
  const conversation = await getOrCreateConversation(organizationId, contact.id, {
    channel: "comments",
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

  const waMessageId = `${COMMENT_IDENTITY_PREFIX[platform]}_${comment.externalCommentId.replace(/[^a-zA-Z0-9]/g, "_")}`;
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
      text: comment.body,
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
  platform: SocialCommentPlatform,
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

/** Sync completa de una organización: Meta comments + TikTok vía Zernio. Nunca lanza. */
export async function syncOrganizationComments(
  organizationId: string
): Promise<SyncResult | { error: string }> {
  const [igCreds, msCreds, ttCreds] = await Promise.all([
    getInstagramCredentialsByOrg(organizationId),
    getMessengerCredentialsByOrg(organizationId),
    isChannelEnabled("tiktok") ? getTikTokCredentialsForComments(organizationId) : null,
  ]);

  const ig = igCreds ? await syncPlatform(organizationId, "instagram", await fetchInstagramComments(igCreds)) : null;
  const ms = msCreds ? await syncPlatform(organizationId, "messenger", await fetchMessengerComments(msCreds)) : null;
  const tt = ttCreds ? await syncPlatform(organizationId, "tiktok", await fetchTikTokComments(ttCreds)) : null;

  if (!ig && !ms && !tt) return { error: "Sin cuenta conectada con acceso a comentarios" };

  const results = [
    ig ? { platform: "Instagram", result: ig } : null,
    ms ? { platform: "Messenger", result: ms } : null,
    tt ? { platform: "TikTok", result: tt } : null,
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const errors = results.flatMap((entry) =>
    "error" in entry.result ? [`${entry.platform}: ${entry.result.error}`] : []
  );
  const counts = results.map((entry) =>
    "error" in entry.result ? { comments: 0, newComments: 0 } : entry.result
  );
  const total: SyncResult = {
    comments: counts.reduce((sum, count) => sum + count.comments, 0),
    newComments: counts.reduce((sum, count) => sum + count.newComments, 0),
  };

  // Si ambas plataformas fallaron, reporta el error; si al menos una funcionó,
  // devuelve el conteo (el fallo parcial no esconde lo sincronizado).
  if (errors.length === results.length && total.comments === 0) {
    return { error: errors.join(" · ") };
  }
  return total;
}

type ZernioCommentEvent = {
  event?: string;
  comment?: {
    id?: string;
    platform?: string;
    platformPostId?: string;
    text?: string;
    createdAt?: string;
    isReply?: boolean;
    parentCommentId?: string | null;
    author?: { id?: string; name?: string; username?: string; isOwnAccount?: boolean };
  };
  post?: {
    platformPostId?: string;
    content?: string | null;
    permalink?: string | null;
    postUrl?: string | null;
    url?: string | null;
  };
};

/** `comment.platform` de Zernio → plataforma interna de la bandeja. */
function socialPlatformFrom(
  platform: string | undefined
): SocialCommentPlatform | null {
  if (platform === "facebook" || platform === "messenger") return "messenger";
  if (platform === "instagram") return "instagram";
  if (platform === "tiktok") return "tiktok";
  return null;
}

/**
 * Normaliza un `comment.received` de Zernio (Facebook, Instagram o TikTok) a
 * la forma que ya ingiere la Bandeja. Pura: devuelve null cuando no hay
 * comentario utilizable —sin id, sin texto, sin autor, sin post— o cuando lo
 * escribió la propia cuenta (el reply del negocio no es un comentario entrante).
 */
export function parseZernioCommentEvent(payload: unknown): {
  platform: SocialCommentPlatform;
  comment: RawSocialComment;
} | null {
  const event = payload as ZernioCommentEvent | null;
  const comment = event?.comment;
  const platform = socialPlatformFrom(comment?.platform);
  const postExternalId = comment?.platformPostId ?? event?.post?.platformPostId;
  if (
    !platform ||
    event?.event !== "comment.received" ||
    !comment?.id ||
    !comment.text?.trim() ||
    !comment.author?.id ||
    !postExternalId ||
    comment.author.isOwnAccount === true
  ) {
    return null;
  }

  const parsedAt = comment.createdAt ? new Date(comment.createdAt) : null;
  return {
    platform,
    comment: {
      externalCommentId: comment.id,
      postExternalId,
      postCaption: event.post?.content ?? null,
      postUrl:
        event.post?.permalink ?? event.post?.postUrl ?? event.post?.url ?? null,
      authorExternalId: comment.author.id,
      authorName: comment.author.name ?? comment.author.username ?? null,
      body: comment.text.trim(),
      parentExternalId: comment.isReply ? comment.parentCommentId ?? null : null,
      commentTime: parsedAt && Number.isFinite(parsedAt.getTime()) ? parsedAt : new Date(),
    },
  };
}

/**
 * Ingesta en tiempo real del webhook oficial `comment.received` de Zernio.
 * Sirve para las tres plataformas que comparten esa API: el canal que recibe
 * el evento (Messenger, Instagram o TikTok) resuelve la organización y llama
 * aquí; el upsert por `externalCommentId` hace el resto sin duplicar nada.
 */
export async function ingestZernioCommentWebhook(
  organizationId: string,
  payload: unknown,
  expected?: SocialCommentPlatform
): Promise<void> {
  const parsed = parseZernioCommentEvent(payload);
  if (!parsed) return;
  // El canal que recibe el evento solo ingerirá comentarios de SU plataforma:
  // una misma llave de Zernio trae varias, y asignarle a la org equivocada un
  // comentario ajeno rompe el reply (el post no existe en esa cuenta).
  if (expected && parsed.platform !== expected) return;
  await upsertCommentIntoInbox({
    organizationId,
    platform: parsed.platform,
    comment: parsed.comment,
  });
}

async function getTikTokCredentialsForComments(
  organizationId: string
): Promise<TikTokCredentials | null> {
  const credentials = await getTikTokCredentialsByOrg(organizationId);
  return credentials?.status === "connected" ? credentials : null;
}
