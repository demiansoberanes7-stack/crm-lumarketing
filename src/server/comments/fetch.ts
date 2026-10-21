import { graphRequest, MetaApiError } from "@/lib/meta/client";
import type { InstagramCredentials } from "@/server/instagram/credentials";
import type { MessengerCredentials } from "@/server/messenger/credentials";
import type { TikTokCredentials } from "@/server/tiktok/credentials";
import { zernioFetch } from "@/server/zernio";

/**
 * Lector de comentarios públicos de publicaciones.
 *
 * Dos transports según la credencial: una conexión Meta (source="meta") lee
 * por Graph API con el token de la página/IG, y una conexión Zernio
 * (source="zernio") lee por el Inbox API unificado (`/inbox/comments`) con la
 * misma llave que ya transporta los DMs. Cada función decide dentro.
 *
 * El token SIEMPRE viaja en el header Authorization, nunca en la query (mismo
 * criterio que meta-insights.ts: las URLs con access_token se filtran en logs
 * de proxies/CDNs/referers).
 */

/** Comentario normalizado, común a ambas plataformas. */
export interface RawSocialComment {
  /** Id del comentario en la plataforma. */
  externalCommentId: string;
  /** Id de la publicación (media de IG / post de la página). */
  postExternalId: string;
  postCaption: string | null;
  /** Enlace público a la publicación, cuando la plataforma lo devuelve. */
  postUrl: string | null;
  /** Id estable del autor (IG user id / PSID). */
  authorExternalId: string;
  authorName: string | null;
  body: string;
  /** Comentario padre cuando es una respuesta dentro de la misma hebra. */
  parentExternalId: string | null;
  commentTime: Date;
}

/** Cuántas publicaciones recientes se revisan y cuántos comentarios por una. */
const DEFAULT_MEDIA_LIMIT = 25;
const DEFAULT_COMMENTS_LIMIT = 50;
const MAX_TIKTOK_COMMENT_PAGES = 10;

type IgMedia = { id: string; caption?: string; timestamp?: string; permalink?: string };
type IgComment = {
  id: string;
  text?: string;
  timestamp?: string;
  username?: string;
  from?: { id?: string; username?: string };
  replies?: { data?: IgComment[] };
};
type FbPost = { id: string; message?: string; created_time?: string; permalink_url?: string };
type FbComment = {
  id: string;
  message?: string;
  created_time?: string;
  from?: { id?: string; name?: string };
  comments?: { data?: FbComment[] };
};

function toDate(ts: string | undefined): Date {
  const n = Number(ts);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000);
  return new Date();
}

function firstNonEmpty(...vals: Array<string | undefined | null>): string | null {
  for (const v of vals) {
    const t = v?.trim();
    if (t) return t;
  }
  return null;
}

/**
 * Comentarios recientes de las publicaciones de un perfil de Instagram.
 * Requiere los scopes `instagram_basic` + `instagram_manage_comments`.
 */
export async function fetchInstagramComments(
  creds: InstagramCredentials,
  opts?: { mediaLimit?: number; commentsLimit?: number }
): Promise<{ comments: RawSocialComment[] } | { error: string }> {
  if (creds.source === "zernio") {
    if (!creds.accountRef) {
      return { error: "Instagram conectado vía Zernio no tiene cuenta enrutable para leer comentarios" };
    }
    return fetchZernioInboxComments(
      { token: creds.token, accountRef: creds.accountRef },
      "instagram",
      { postLimit: opts?.mediaLimit, commentsLimit: opts?.commentsLimit }
    );
  }
  const mediaLimit = opts?.mediaLimit ?? DEFAULT_MEDIA_LIMIT;
  const commentsLimit = opts?.commentsLimit ?? DEFAULT_COMMENTS_LIMIT;

  try {
    const media = await graphRequest<{ data?: IgMedia[] }>(
      `${creds.igUserId}/media?fields=id,caption,timestamp,permalink&limit=${mediaLimit}`,
      { method: "GET", token: creds.token }
    );

    const comments: RawSocialComment[] = [];
    for (const m of media.data ?? []) {
      const edge = await graphRequest<{ data?: IgComment[] }>(
        `${m.id}/comments?fields=id,text,timestamp,username,from{id,username},replies{id,text,timestamp,username,from{id,username}}&limit=${commentsLimit}`,
        { method: "GET", token: creds.token }
      );
      for (const c of edge.data ?? []) {
        const parentAuthor = firstNonEmpty(c.from?.id, c.username);
        const body = (c.text ?? "").trim();
        if (!body || !parentAuthor) continue; // sin texto o sin autor: descartar
        comments.push({
          externalCommentId: c.id,
          postExternalId: m.id,
          postCaption: firstNonEmpty(m.caption),
          postUrl: firstNonEmpty(m.permalink),
          authorExternalId: parentAuthor,
          authorName: firstNonEmpty(c.from?.username, c.username),
          body,
          parentExternalId: null,
          commentTime: toDate(c.timestamp),
        });
        // Respuestas dentro del mismo comentario (un solo nivel).
        for (const r of c.replies?.data ?? []) {
          const rAuthor = firstNonEmpty(r.from?.id, r.username);
          const rBody = (r.text ?? "").trim();
          if (!rBody || !rAuthor) continue;
          comments.push({
            externalCommentId: r.id,
            postExternalId: m.id,
            postCaption: firstNonEmpty(m.caption),
            postUrl: firstNonEmpty(m.permalink),
            authorExternalId: rAuthor,
            authorName: firstNonEmpty(r.from?.username, r.username),
            body: rBody,
            parentExternalId: c.id,
            commentTime: toDate(r.timestamp),
          });
        }
      }
    }
    return { comments };
  } catch (err) {
    if (err instanceof MetaApiError) {
      return { error: err.isAuthError ? "El token de Instagram expiró o no tiene permiso de comentarios" : err.message };
    }
    return { error: err instanceof Error ? err.message : "No se pudieron leer los comentarios de Instagram" };
  }
}

/**
 * Comentarios recientes de las publicaciones de una página de Facebook.
 * Requiere el permiso `pages_read_engagement` (y `pages_show_list`).
 */
export async function fetchMessengerComments(
  creds: MessengerCredentials,
  opts?: { postLimit?: number; commentsLimit?: number }
): Promise<{ comments: RawSocialComment[] } | { error: string }> {
  if (creds.source === "zernio") {
    // Zernio sí expone los comentarios de la página por el Inbox API: la
    // variante que antes degradaba ya no existe.
    if (!creds.accountRef) {
      return { error: "Messenger conectado vía Zernio no tiene cuenta enrutable para leer comentarios" };
    }
    return fetchZernioInboxComments(
      { token: creds.token, accountRef: creds.accountRef },
      "facebook",
      opts
    );
  }
  if (!creds.pageId) {
    return { error: "Messenger necesita una página de Meta (source=meta) con pageId para leer comentarios" };
  }
  const postLimit = opts?.postLimit ?? DEFAULT_MEDIA_LIMIT;
  const commentsLimit = opts?.commentsLimit ?? DEFAULT_COMMENTS_LIMIT;

  try {
    const posts = await graphRequest<{ data?: FbPost[] }>(
      `${creds.pageId}/published_posts?fields=id,message,created_time,permalink_url&limit=${postLimit}`,
      { method: "GET", token: creds.token }
    );

    const comments: RawSocialComment[] = [];
    for (const p of posts.data ?? []) {
      const edge = await graphRequest<{ data?: FbComment[] }>(
        `${p.id}/comments?fields=id,message,created_time,from{id,name},comments{id,message,created_time,from{id,name}}&limit=${commentsLimit}`,
        { method: "GET", token: creds.token }
      );
      for (const c of edge.data ?? []) {
        const author = firstNonEmpty(c.from?.id);
        const body = (c.message ?? "").trim();
        if (!body || !author) continue;
        comments.push({
          externalCommentId: c.id,
          postExternalId: p.id,
          postCaption: firstNonEmpty(p.message),
          postUrl: firstNonEmpty(p.permalink_url),
          authorExternalId: author,
          authorName: firstNonEmpty(c.from?.name),
          body,
          parentExternalId: null,
          commentTime: toDate(c.created_time),
        });
        // Respuestas dentro del mismo comentario (un solo nivel).
        for (const r of c.comments?.data ?? []) {
          const rAuthor = firstNonEmpty(r.from?.id);
          const rBody = (r.message ?? "").trim();
          if (!rBody || !rAuthor) continue;
          comments.push({
            externalCommentId: r.id,
            postExternalId: p.id,
            postCaption: firstNonEmpty(p.message),
            postUrl: firstNonEmpty(p.permalink_url),
            authorExternalId: rAuthor,
            authorName: firstNonEmpty(r.from?.name),
            body: rBody,
            parentExternalId: c.id,
            commentTime: toDate(c.created_time),
          });
        }
      }
    }
    return { comments };
  } catch (err) {
    if (err instanceof MetaApiError) {
      return { error: err.isAuthError ? "El token de la página expiró o no tiene permiso de comentarios" : err.message };
    }
    return { error: err instanceof Error ? err.message : "No se pudieron leer los comentarios de la página" };
  }
}

type ZernioTikTokComment = {
  id?: string;
  message?: string;
  createdTime?: string;
  parentId?: string | null;
  replies?: ZernioTikTokComment[];
  repliesHasMore?: boolean;
  from?: { id?: string; name?: string; username?: string };
};

/** Plataformas con comentarios en el Inbox de Zernio (API unificada). */
type ZernioInboxPlatform = "facebook" | "instagram" | "tiktok";

/**
 * Comentarios recientes vía el Inbox de Zernio, común a las tres plataformas:
 * lista los posts comentados y luego el hilo de cada uno (mismo normalized
 * shape en todas: `id`, `message`, `createdTime`, `from`, `replies`).
 *
 * Facebook capa los replies en 10 con `repliesHasMore`: cuando se levanta, se
 * pide el hilo completo con `commentId` para no perder el resto de la
 * conversación.
 */
async function fetchZernioInboxComments(
  creds: { token: string; accountRef: string },
  platform: ZernioInboxPlatform,
  opts?: { postLimit?: number; commentsLimit?: number }
): Promise<{ comments: RawSocialComment[] } | { error: string }> {
  const postLimit = Math.min(Math.max(opts?.postLimit ?? DEFAULT_MEDIA_LIMIT, 1), 100);
  const commentsLimit = Math.min(Math.max(opts?.commentsLimit ?? DEFAULT_COMMENTS_LIMIT, 1), 100);

  try {
    const postsResponse = (await zernioFetch(
      `/inbox/comments?platform=${platform}&accountId=${encodeURIComponent(creds.accountRef)}&limit=${postLimit}`,
      { token: creds.token }
    )) as {
      data?: Array<{
        id?: string;
        platformPostId?: string;
        content?: string | null;
        commentCount?: number;
        permalink?: string | null;
        postUrl?: string | null;
        url?: string | null;
      }>;
    };

    const comments: RawSocialComment[] = [];
    const seen = new Set<string>();
    for (const post of postsResponse.data ?? []) {
      const postExternalId = post.platformPostId ?? post.id;
      if (!postExternalId || (post.commentCount ?? 0) <= 0) continue;
      const postUrl = firstNonEmpty(post.permalink, post.postUrl, post.url);

      let cursor: string | null = null;
      for (let page = 0; page < MAX_TIKTOK_COMMENT_PAGES; page++) {
        const query = new URLSearchParams({
          accountId: creds.accountRef,
          limit: String(commentsLimit),
          ...(cursor ? { cursor } : {}),
        });
        const response = (await zernioFetch(
          `/inbox/comments/${encodeURIComponent(postExternalId)}?${query}`,
          { token: creds.token }
        )) as {
          comments?: ZernioTikTokComment[];
          pagination?: { hasMore?: boolean; cursor?: string | null };
        };

        for (const comment of response.comments ?? []) {
          appendZernioComment(comments, seen, comment, postExternalId, post.content ?? null, postUrl, null);
          for (const reply of comment.replies ?? []) {
            appendZernioComment(comments, seen, reply, postExternalId, post.content ?? null, postUrl, comment.id ?? null);
          }
          // Facebook: los replies en línea están capados a 10; el resto se
          // pide con commentId (prefiere el reply completo al conteo exacto).
          if (comment.repliesHasMore && comment.id) {
            const threadQuery = new URLSearchParams({
              accountId: creds.accountRef,
              commentId: comment.id,
              limit: String(commentsLimit),
            });
            const thread = (await zernioFetch(
              `/inbox/comments/${encodeURIComponent(postExternalId)}?${threadQuery}`,
              { token: creds.token }
            )) as { comments?: ZernioTikTokComment[] };
            for (const reply of thread.comments ?? []) {
              appendZernioComment(comments, seen, reply, postExternalId, post.content ?? null, postUrl, comment.id);
            }
          }
        }

        const nextCursor = response.pagination?.cursor;
        if (!response.pagination?.hasMore || !nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }
    }
    return { comments };
  } catch (err) {
    if (err instanceof MetaApiError) {
      return { error: err.isAuthError ? "La API key de Zernio expiró: reconecta la cuenta" : err.message };
    }
    return { error: err instanceof Error ? err.message : "No se pudieron leer los comentarios de Zernio" };
  }
}

/**
 * Comentarios de videos TikTok conectados a Zernio.
 * Zernio exige una cuenta TikTok for Business para Inbox, y recomienda el
 * webhook comment.received; este barrido cubre posts recientes como respaldo.
 */
export async function fetchTikTokComments(
  creds: TikTokCredentials,
  opts?: { postLimit?: number; commentsLimit?: number }
): Promise<{ comments: RawSocialComment[] } | { error: string }> {
  if (creds.source !== "zernio" || !creds.accountRef) {
    return { error: "TikTok necesita una cuenta de Zernio para leer comentarios" };
  }
  return fetchZernioInboxComments(
    { token: creds.token, accountRef: creds.accountRef },
    "tiktok",
    opts
  );
}

function appendZernioComment(
  comments: RawSocialComment[],
  seen: Set<string>,
  comment: ZernioTikTokComment,
  postExternalId: string,
  postCaption: string | null,
  postUrl: string | null,
  parentExternalId: string | null
): void {
  const authorExternalId = comment.from?.id;
  const body = comment.message?.trim();
  if (!comment.id || !authorExternalId || !body) return;
  // El hilo completo de Facebook reentrega los mismos replies que la lista:
  // sin este corte se duplicaría la conversación en la Bandeja.
  if (seen.has(comment.id)) return;
  seen.add(comment.id);
  const parsedAt = comment.createdTime ? new Date(comment.createdTime) : null;
  comments.push({
    externalCommentId: comment.id,
    postExternalId,
    postCaption,
    postUrl,
    authorExternalId,
    authorName: firstNonEmpty(comment.from?.name, comment.from?.username),
    body,
    parentExternalId: parentExternalId ?? comment.parentId ?? null,
    commentTime: parsedAt && Number.isFinite(parsedAt.getTime()) ? parsedAt : new Date(),
  });
}
