"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  MessageCircle,
  Sparkles,
  Store,
} from "lucide-react";
import { ContactAvatar } from "@/components/avatar";
import { ChannelBadge } from "@/components/channel-badge";
import { commentBodyText } from "@/lib/comments-format";
import { groupCommentsByPost } from "@/lib/comment-thread";
import type { MessageCommentDto, MessageDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Hilo del canal Comentarios con la lectura de Facebook: cada publicación se
 * muestra UNA vez con su caption y enlace, y debajo van los comentarios con
 * autor, hora y respuestas anidadas. El hilo es de la PERSONA, así que puede
 * tener varias publicaciones: cada una lleva su propia tarjeta, en orden.
 */

const PLATFORM = {
  instagram: { label: "Instagram", postLabel: "Publicación de Instagram" },
  messenger: { label: "Facebook", postLabel: "Publicación de Facebook" },
  tiktok: { label: "TikTok", postLabel: "Video de TikTok" },
} as const;

const FACEBOOK_PATH =
  "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z";

function PlatformMark({ platform }: { platform: MessageCommentDto["platform"] }) {
  if (platform === "messenger") {
    return (
      <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-[#1877f2]">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3 fill-white">
          <path d={FACEBOOK_PATH} />
        </svg>
      </span>
    );
  }
  return (
    <ChannelBadge channel={platform} className="h-[18px] w-[18px] rounded-[5px]" />
  );
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}

function bubbleTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function PostContext({
  platform,
  caption,
  postUrl,
}: {
  platform: MessageCommentDto["platform"];
  caption: string | null;
  postUrl: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = PLATFORM[platform];
  const long = (caption?.length ?? 0) > 220;
  return (
    <section className="overflow-hidden rounded-xl border border-border-strong bg-background shadow-sm">
      <header className="flex items-center gap-2.5 border-b border-border bg-subtle px-4 py-2.5">
        <PlatformMark platform={platform} />
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold leading-tight">{meta.postLabel}</p>
          <p className="text-[10.5px] leading-tight text-text-3">Comentarios públicos</p>
        </div>
        {postUrl && (
          <a
            href={postUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-background px-2.5 py-1 text-[11px] font-semibold text-text-2 transition-colors hover:border-text-3 hover:text-foreground"
          >
            Ver publicación
            <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
          </a>
        )}
      </header>
      <div className="px-4 py-3">
        {caption ? (
          <>
            <p
              className={cn(
                "whitespace-pre-wrap break-words text-[13px] leading-[1.55] text-text-2",
                long && !expanded && "line-clamp-3"
              )}
            >
              {caption}
            </p>
            {long && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 text-[11.5px] font-semibold text-brand-text hover:underline"
              >
                {expanded ? "Ver menos" : "Ver más"}
              </button>
            )}
          </>
        ) : (
          <p className="text-[12.5px] italic text-text-3">
            La publicación no tiene texto.
          </p>
        )}
      </div>
    </section>
  );
}

function CommentRow({
  message,
  postCaption,
  contactName,
  nested,
}: {
  message: MessageDto;
  postCaption: string | null;
  contactName: string;
  nested: boolean;
}) {
  const out = message.direction === "out";
  const authorName =
    (out ? "Tu negocio" : message.comment?.authorName?.trim()) || contactName;
  const body = commentBodyText(
    message.text,
    message.comment?.postCaption ?? postCaption
  );

  return (
    <article
      className={cn(
        "flex gap-3 px-4 py-3",
        out ? "bg-bubble-out" : "bg-background",
        nested && "ml-10 border-l-2 border-border-strong pl-3"
      )}
    >
      {out ? (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg">
          <Store className="h-3.5 w-3.5" strokeWidth={1.9} />
        </span>
      ) : (
        <ContactAvatar name={authorName} seed={authorName} size="sm" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold leading-tight">
            {authorName}
          </span>
          {out && (
            <span className="rounded-full border border-bubble-out-border bg-background px-1.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-text-3">
              Página
            </span>
          )}
          {message.aiGenerated && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-brand"
              title="Respuesta generada por IA"
            >
              <Sparkles className="h-3 w-3" strokeWidth={1.7} /> IA
            </span>
          )}
          <time
            dateTime={message.createdAt}
            title={new Date(message.createdAt).toLocaleString("es-MX")}
            className="font-mono text-[10.5px] tracking-[0.04em] text-text-3"
          >
            {bubbleTime(message.createdAt)}
          </time>
          {out && message.status === "pending" && (
            <span className="text-[10.5px] text-text-3">Enviando…</span>
          )}
        </div>
        {body ? (
          <p className="mt-1 whitespace-pre-wrap break-words text-[13.5px] leading-[1.5]">
            {body}
          </p>
        ) : (
          <p className="mt-1 text-[12.5px] italic text-text-3">Comentario sin texto</p>
        )}
        {out && message.status === "failed" && (
          <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-danger-soft bg-danger-tint px-2 py-1.5 text-[11.5px] leading-snug text-danger-text">
            <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span>
              <span className="font-semibold">No se publicó.</span>{" "}
              {message.error ?? "La plataforma no informó el motivo."}
            </span>
          </p>
        )}
      </div>
    </article>
  );
}

export function CommentsThread({
  messages,
  contactName,
}: {
  messages: MessageDto[];
  contactName: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const comments = messages.flatMap((m) => (m.comment ? [m.comment] : []));
  const groups = groupCommentsByPost(messages);
  // Solo se anida una respuesta si su padre está en esta misma hebra: si el
  // autor respondió a un comentario de otra persona, sangrar el renglón haría
  // creer que cuelga del comentario anterior.
  const commentIds = new Set(comments.map((c) => c.externalCommentId));

  return (
    <div
      ref={scrollRef}
      data-message-thread
      className="thread-bg flex flex-1 flex-col overflow-y-auto overscroll-contain px-3 py-5 sm:px-[4%]"
    >
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3">
        {groups.map((group) => (
          <Fragment key={group.key}>
            <PostContext
              platform={group.platform}
              caption={group.postCaption}
              postUrl={group.postUrl}
            />

            <section className="overflow-hidden rounded-xl border border-border-strong bg-background shadow-sm">
              <header className="flex items-center gap-2 border-b border-border bg-subtle px-4 py-2.5">
                <MessageCircle className="h-4 w-4 text-brand" strokeWidth={1.8} />
                <p className="text-[12.5px] font-semibold">Comentarios</p>
                <span className="rounded-full border border-border-strong bg-background px-1.5 text-[10.5px] font-semibold text-text-3">
                  {group.inboundCount}
                </span>
                <span className="ml-auto rounded-full border border-border-strong bg-background px-2 py-0.5 text-[10.5px] font-medium text-text-3">
                  Público
                </span>
              </header>

              <div className="divide-y divide-border">
                {group.messages.map((m, i) => {
                  const prev = group.messages[i - 1];
                  const newDay =
                    !prev ||
                    new Date(prev.createdAt).toDateString() !==
                      new Date(m.createdAt).toDateString();
                  const parentId = m.comment?.parentExternalId ?? null;
                  return (
                    <div key={m.id}>
                      {newDay && (
                        <div className="flex items-center gap-3 border-b border-border bg-subtle px-4 py-1.5">
                          <span className="kicker text-text-3">{dayLabel(m.createdAt)}</span>
                          <span className="h-px flex-1 bg-border" />
                        </div>
                      )}
                      <CommentRow
                        message={m}
                        postCaption={group.postCaption}
                        contactName={contactName}
                        nested={Boolean(parentId && commentIds.has(parentId))}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
