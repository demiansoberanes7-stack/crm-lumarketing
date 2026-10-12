import { graphRequest, MetaApiError } from "@/lib/meta/client";
import type { InstagramCredentials } from "@/server/instagram/credentials";
import type { MessengerCredentials } from "@/server/messenger/credentials";

/**
 * Lector de comentarios públicos de publicaciones vía Graph API.
 *
 * Instagram y la página de Facebook publican los comentarios de SUS posts.
 * Detrás de una credencial de Meta (source="meta"): una llave de Zernio no
 * puede leerlos (Zernio solo transporta DMs), así que en ese caso se degrada
 * con un `error` claro y el resto de la ingesta sigue.
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

type IgMedia = { id: string; caption?: string; timestamp?: string };
type IgComment = {
  id: string;
  text?: string;
  timestamp?: string;
  username?: string;
  from?: { id?: string; username?: string };
  replies?: { data?: IgComment[] };
};
type FbPost = { id: string; message?: string; created_time?: string };
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
  if (creds.source !== "meta") {
    return { error: "Instagram conectado vía Zernio no expone comentarios (solo mensajes directos)" };
  }
  const mediaLimit = opts?.mediaLimit ?? DEFAULT_MEDIA_LIMIT;
  const commentsLimit = opts?.commentsLimit ?? DEFAULT_COMMENTS_LIMIT;

  try {
    const media = await graphRequest<{ data?: IgMedia[] }>(
      `${creds.igUserId}/media?fields=id,caption,timestamp&limit=${mediaLimit}`,
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
  if (creds.source !== "meta" || !creds.pageId) {
    return { error: "Messenger necesita una página de Meta (source=meta) con pageId para leer comentarios" };
  }
  const postLimit = opts?.postLimit ?? DEFAULT_MEDIA_LIMIT;
  const commentsLimit = opts?.commentsLimit ?? DEFAULT_COMMENTS_LIMIT;

  try {
    const posts = await graphRequest<{ data?: FbPost[] }>(
      `${creds.pageId}/published_posts?fields=id,message,created_time&limit=${postLimit}`,
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
