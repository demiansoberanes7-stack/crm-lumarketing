import type { MessageCommentDto, MessageDto } from "@/lib/types";

/**
 * Identidad de los comentarios públicos en la Bandeja.
 *
 * La versión anterior incluía la publicación (`fbc:<post>:<autor>`), así que
 * una misma persona aparecía una vez por cada post donde comentaba. Ahora la
 * identidad es `prefijo:autor` y el hilo es de la PERSONA; la publicación vive
 * en cada mensaje (`social_comment`), no en el contacto.
 *
 * Las identidades viejas se siguen leyendo: la bandeja agrupa `prefijo:post:autor`
 * con `prefijo:autor` sin mover ni borrar filas.
 */

export type SocialCommentPlatform = "instagram" | "messenger" | "tiktok";

export const COMMENT_IDENTITY_PREFIX: Record<SocialCommentPlatform, string> = {
  instagram: "igc",
  messenger: "fbc",
  tiktok: "ttc",
};

const PLATFORM_BY_PREFIX: Record<string, SocialCommentPlatform> = {
  igc: "instagram",
  fbc: "messenger",
  ttc: "tiktok",
};

export type ParsedCommentIdentity = {
  platform: SocialCommentPlatform;
  authorExternalId: string;
  /** Publicación incrustada por la identidad vieja; null en las nuevas. */
  legacyPostExternalId: string | null;
};

export function commentContactIdentity(
  platform: SocialCommentPlatform,
  authorExternalId: string
): string {
  return `${COMMENT_IDENTITY_PREFIX[platform]}:${authorExternalId}`;
}

export function parseCommentIdentity(identity: string): ParsedCommentIdentity | null {
  const first = identity.indexOf(":");
  if (first <= 0) return null;
  const platform = PLATFORM_BY_PREFIX[identity.slice(0, first)];
  if (!platform) return null;
  const rest = identity.slice(first + 1);
  if (!rest) return null;
  const last = rest.lastIndexOf(":");
  if (last < 0) {
    return { platform, authorExternalId: rest, legacyPostExternalId: null };
  }
  return {
    platform,
    authorExternalId: rest.slice(last + 1),
    legacyPostExternalId: rest.slice(0, last),
  };
}

/**
 * Llave de agrupación: prefijo + autor. Es la misma para la identidad vieja y
 * la nueva, así los hilos históricos se funden en la lista sin tocar la BD.
 */
export function commentGroupKey(identity: string): string {
  const parsed = parseCommentIdentity(identity);
  return parsed
    ? `${COMMENT_IDENTITY_PREFIX[parsed.platform]}:${parsed.authorExternalId}`
    : identity;
}

/** Fila mínima de conversación que necesita la agrupación de la Bandeja. */
type CommentThreadRow = {
  conversation: { channel: string; unreadCount: number };
  contact: { waIdentity: string };
};

/**
 * Deja UNA fila por persona en el canal Comentarios. Las filas deben venir
 * ordenadas de la más reciente a la más vieja (como las entrega SQL): la
 * primera de cada grupo es la que se abre y hereda el total sin leer.
 */
export function foldCommentThreads<T extends CommentThreadRow>(rows: T[]): T[] {
  const groups = new Map<string, T>();
  const out: T[] = [];
  for (const row of rows) {
    if (row.conversation.channel !== "comments") {
      out.push(row);
      continue;
    }
    const key = commentGroupKey(row.contact.waIdentity);
    const existing = groups.get(key);
    if (existing) {
      existing.conversation.unreadCount += row.conversation.unreadCount;
      continue;
    }
    const copy = { ...row, conversation: { ...row.conversation } };
    groups.set(key, copy);
    out.push(copy);
  }
  return out;
}

export type CommentPostGroup = {
  /** `plataforma:post`; distingue dos publicaciones aunque compartan caption. */
  key: string;
  platform: MessageCommentDto["platform"];
  postExternalId: string;
  postCaption: string | null;
  postUrl: string | null;
  messages: MessageDto[];
  inboundCount: number;
};

function lastActivity(group: CommentPostGroup): number {
  const last = group.messages[group.messages.length - 1];
  return last ? new Date(last.createdAt).getTime() : 0;
}

/**
 * Agrupa el hilo de una persona por publicación. Un hilo puede tener varios
 * posts (la persona comentó en más de uno); cada grupo se pinta con SU tarjeta
 * de publicación. Los salientes no traen post: cuelgan del último comentario
 * visto, que es exactamente al que respondió el servidor.
 */
export function groupCommentsByPost(messages: MessageDto[]): CommentPostGroup[] {
  const groups = new Map<string, CommentPostGroup>();
  const pendingOut: MessageDto[] = [];
  let currentKey: string | null = null;

  for (const message of messages) {
    const comment = message.comment;
    if (!comment) {
      const current = currentKey ? groups.get(currentKey) : undefined;
      if (current) current.messages.push(message);
      else pendingOut.push(message);
      continue;
    }
    const key = `${comment.platform}:${comment.postExternalId}`;
    currentKey = key;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        platform: comment.platform,
        postExternalId: comment.postExternalId,
        postCaption: null,
        postUrl: null,
        messages: [],
        inboundCount: 0,
      };
      groups.set(key, group);
      if (pendingOut.length) group.messages.push(...pendingOut.splice(0));
    }
    group.postCaption ??= comment.postCaption;
    group.postUrl ??= comment.postUrl;
    group.messages.push(message);
    group.inboundCount += 1;
  }

  return [...groups.values()].sort((a, b) => lastActivity(a) - lastActivity(b));
}
