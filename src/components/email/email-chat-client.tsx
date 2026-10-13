"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Mail, Pencil, RefreshCw, Search, Send, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { matchesQuery } from "@/lib/search";
import { ContactAvatar } from "@/components/avatar";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import { ChannelBadge } from "@/components/channel-badge";
import { formatTime } from "@/components/inbox/helpers";
import type { EmailChatThread } from "@/app/api/email/threads/route";
import { bufferToBase64 } from "@/lib/base64";
import { EmailComposeDialog, type EmailAttachment } from "./email-compose-dialog";

type EmailAccount = { id: string; label: string | null; email: string; enabled: boolean };

function bubbleTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Buzón de correo con el MISMO diseño de la Bandeja (ConversationList /
 * InboxClient / Composer): mismo header con título y buscador en píldora,
 * mismos renglones con avatar, barra de acento activa y badge de no leídos,
 * mismo hilo con burujas y mismo compositor en píldora. El correo es una
 * bandeja más, no una pantalla ajena.
 */
export function EmailChatClient({ channels }: { channels: readonly Channel[] }) {
  const multiChannel = channels.length > 1;
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [threads, setThreads] = useState<EmailChatThread[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyAttachments, setReplyAttachments] = useState<EmailAttachment[]>([]);
  const replyFileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Rescate de lo tecleado ANTES de que hidratara el JS (mismo truco que
  // ConversationList): el input se pinta en el HTML del servidor.
  useEffect(() => {
    const typed = inputRef.current?.value ?? "";
    if (typed) setQuery(typed);
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/email/accounts").catch(() => null);
      if (!res?.ok) return;
      const data = await res.json().catch(() => ({ accounts: [] }));
      const list: EmailAccount[] = data.accounts ?? [];
      setAccounts(list);
      setAccountId((prev) => prev ?? list.find((a) => a.enabled)?.id ?? list[0]?.id ?? null);
    })();
  }, []);

  const refetch = useCallback(async (opts?: { silent?: boolean }) => {
    if (!accountId) return;
    if (!opts?.silent) setLoading(true);
    setError(null);
    const res = await fetch(`/api/email/threads?accountId=${accountId}`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => ({ threads: [] }));
      setThreads(data.threads ?? []);
    } else {
      setError("No se pudieron cargar los correos.");
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Refresco por sondeo: el buzón no tiene SSE, igual que el contador de
  // correos sin leer de la Bandeja (que también sondea cada minuto).
  useEffect(() => {
    const id = setInterval(() => void refetch({ silent: true }), 60_000);
    return () => clearInterval(id);
  }, [refetch]);

  /**
   * Refresh manual = sincronía IMAP real, no solo releer la BD: sin esto el
   * botón daba la impresión de "actualizar" pero los correos nuevos solo
   * llegaban cuando el poller del servidor corría.
   */
  const syncMail = useCallback(async () => {
    if (!accountId || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);
    const res = await fetch(`/api/email/accounts/${accountId}/sync`, { method: "POST" }).catch(() => null);
    syncingRef.current = false;
    setSyncing(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => null);
      setSyncError(data?.error?.message ?? "No se pudo sincronizar el correo.");
    }
    await refetch();
  }, [accountId, refetch]);

  // Al entrar al buzón: pinta lo que ya hay y dispara una sincronía en
  // segundo plano para traer lo que haya llegado mientras no estabas.
  useEffect(() => { void syncMail(); }, [syncMail]);

  const selected = threads?.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selectedId, selected?.messages.length]);

  function autogrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  /** Al abrir un hilo se marcan como leídos sus correos entrantes. */
  function markRead(thread: EmailChatThread) {
    const unseen = thread.messages.filter((m) => m.direction === "inbound" && !m.seen);
    if (unseen.length === 0) return;
    for (const m of unseen) {
      void fetch(`/api/email/messages/${m.id}`, { method: "PATCH" }).catch(() => null);
    }
    setThreads((prev) =>
      (prev ?? []).map((t) =>
        t.id === thread.id
          ? { ...t, unread: false, unreadCount: 0, messages: t.messages.map((m) => ({ ...m, seen: true })) }
          : t
      )
    );
  }

  function select(thread: EmailChatThread) {
    setSelectedId(thread.id);
    setError(null);
    markRead(thread);
  }

  async function sendReply() {
    if (!selected || !replyBody.trim() || !accountId) return;
    setSending(true);
    setError(null);
    const last = selected.messages[selected.messages.length - 1];
    const res = await fetch("/api/email/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId,
        to: selected.participant.email,
        subject: selected.subject.startsWith("Re:") ? selected.subject : `Re: ${selected.subject}`,
        text: replyBody.trim(),
        // El Message-ID RFC (no el id de BD): es lo que el cliente de correo
        // usa para hilar. Apunta al último mensaje del hilo sin importar la
        // dirección — así dos respuestas seguidas del agente no rompen el hilo.
        inReplyTo: last?.messageId ?? null,
        attachments: replyAttachments.length > 0 ? replyAttachments : undefined,
      }),
    }).catch(() => null);
    setSending(false);
    if (res?.ok) {
      setReplyBody("");
      setReplyAttachments([]);
      if (taRef.current) taRef.current.style.height = "auto";
      await refetch({ silent: true });
    } else {
      const data = await res?.json().catch(() => null);
      setError(data?.error?.message ?? "No se pudo enviar la respuesta.");
      // Lo que no salió vuelve al campo: nada se pierde en silencio.
      setReplyBody((actual) => actual);
      taRef.current?.focus();
      setTimeout(autogrow, 0);
    }
  }

  async function handleReplyFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const next: EmailAttachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) {
        setError(`El archivo ${file.name} supera 10MB`);
        continue;
      }
      const buffer = await file.arrayBuffer();
      next.push({ filename: file.name, content: bufferToBase64(buffer), contentType: file.type || "application/octet-stream" });
    }
    setReplyAttachments((prev) => [...prev, ...next]);
    if (replyFileRef.current) replyFileRef.current.value = "";
  }

  const list = threads ?? [];
  const searched = list.filter((t) =>
    matchesQuery(query, { text: [t.participant.name, t.participant.email, t.subject] })
  );
  const visible = filter === "unread" ? searched.filter((t) => t.unread) : searched;
  const unreadThreads = searched.filter((t) => t.unread).length;
  const firstLoad = threads === null;

  if (accounts.length > 1 && !accountId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-serif text-[21px] italic leading-tight text-foreground">
          Elige una cuenta de correo
        </p>
        <p className="text-xs text-text-3">Para ver sus conversaciones, selecciona el buzón en el panel izquierdo.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* ═══ LISTA DE HILOS ═══ */}
      <section
        className={cn(
          "flex w-full shrink-0 flex-col overflow-hidden border-r md:w-[300px] lg:w-[360px]",
          selected && "max-md:hidden"
        )}
      >
        <header className="border-b px-4 pb-3 pt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-bold tracking-tight">Buzón</h2>
            <span className="font-mono text-[12px] text-text-3">{list.length}</span>
            <div className="ml-auto flex max-w-full items-center gap-1 overflow-x-auto">
              <Button
                onClick={() => setComposeOpen(true)}
                disabled={!accountId}
                size="sm"
                className="h-9 shrink-0"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} /> Redactar
              </Button>
              <Link
                href="/inbox"
                className="flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border-strong px-2.5 text-[12.5px] font-semibold text-text-2 transition-colors hover:border-text-3 hover:bg-accent"
              >
                Bandeja
              </Link>
              {multiChannel &&
                channels.map((ch) => (
                  <Link
                    key={ch}
                    href={`/inbox?channel=${ch}`}
                    title={CHANNEL_LABEL[ch]}
                    aria-label={CHANNEL_LABEL[ch]}
                    className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-border-strong text-text-3 transition-colors hover:border-text-3 hover:bg-accent hover:text-foreground"
                  >
                    <ChannelBadge channel={ch} className="h-[14px] w-[14px] rounded-[4px]" />
                  </Link>
                ))}
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border-strong bg-background px-3.5 py-[7px] shadow-sm transition-[border-color,box-shadow] focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft">
            <Search className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.7} />
            <input
              ref={inputRef}
              placeholder="Buscar por nombre, correo o asunto…"
              aria-label="Buscar correo"
              defaultValue=""
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-3"
            />
            {query && (
              <button
                onClick={() => {
                  if (inputRef.current) inputRef.current.value = "";
                  setQuery("");
                  inputRef.current?.focus();
                }}
                aria-label="Limpiar búsqueda"
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-text-3 hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5">
          {(
            [
              { id: "all", label: "Todas", count: searched.length },
              { id: "unread", label: "No leídas", count: unreadThreads },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[12.5px] font-semibold transition-colors",
                filter === f.id
                  ? "border-brand bg-brand text-brand-fg"
                  : "border-border-strong bg-background text-text-2 hover:border-text-3"
              )}
            >
              {f.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px]",
                  filter === f.id ? "bg-brand-veil" : "bg-secondary text-text-3"
                )}
              >
                {f.count}
              </span>
            </button>
          ))}
          {accounts.length > 1 && (
            <select
              value={accountId ?? ""}
              onChange={(e) => { setAccountId(e.target.value); setSelectedId(null); }}
              aria-label="Cuenta de correo"
              className="ml-auto min-h-11 min-w-[110px] max-w-[42%] truncate rounded-full border border-border-strong bg-background px-2 text-[12.5px] font-semibold text-text-2 transition-colors hover:border-text-3"
            >
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label ?? a.email}</option>)}
            </select>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn("ml-auto h-11 w-11 shrink-0", accounts.length <= 1 && "ml-0")}
            onClick={() => void syncMail()}
            disabled={syncing || !accountId}
            aria-label="Sincronizar correo"
            title="Sincronizar correo"
          >
            <RefreshCw className={cn("h-4 w-4", (syncing || loading) && "animate-spin")} strokeWidth={1.7} />
          </Button>
        </div>

        {syncError && (
          <p role="alert" className="border-b px-4 py-2.5 text-xs text-danger-text">
            {syncError}
          </p>
        )}

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {firstLoad && loading ? (
            <p className="p-6 text-center text-xs text-text-3">Cargando…</p>
          ) : list.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="font-serif text-[21px] italic leading-tight text-foreground">
                Sin correos todavía
              </p>
              <p className="text-xs text-text-3">
                Los mensajes que lleguen a tu buzón aparecerán aquí en tiempo real.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <p className="p-6 text-center text-xs text-text-3">
              Sin resultados para este filtro.
            </p>
          ) : (
            <ul>
              {visible.map((t) => {
                const unread = t.unread;
                const active = selectedId === t.id;
                const snippet =
                  t.messages[t.messages.length - 1]?.text?.replace(/\s+/g, " ").slice(0, 90) ??
                  "(sin contenido)";
                return (
                  <li key={t.id} className="relative border-b border-border">
                    {active && (
                      <span className="absolute inset-y-0 left-0 w-[3px] bg-brand" />
                    )}
                    <button
                      onClick={() => select(t)}
                      className={cn(
                        "flex w-full items-start gap-[11px] px-4 py-[var(--row-py)] text-left transition-colors",
                        active ? "bg-[var(--bg-active)]" : "hover:bg-subtle"
                      )}
                    >
                      <ContactAvatar
                        name={t.participant.name}
                        seed={t.participant.email}
                        size="lg"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "truncate text-sm",
                              unread ? "font-[680]" : "font-semibold"
                            )}
                          >
                            {t.participant.name}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 font-mono text-[10.5px] tracking-[0.02em]",
                              unread ? "font-semibold text-brand" : "text-text-3"
                            )}
                          >
                            {formatTime(t.latestAt)}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "truncate text-[13px]",
                              unread ? "font-medium text-text-2" : "text-text-3"
                            )}
                          >
                            {t.subject}
                          </span>
                          {unread && t.unreadCount > 0 && (
                            <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-semibold text-brand-fg">
                              {t.unreadCount > 99 ? "99+" : t.unreadCount}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[13px] text-text-3">
                          {snippet}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ═══ HILO EN CHAT ═══ */}
      <section
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          !selected && "max-md:hidden"
        )}
      >
        {selected ? (
          <>
            <header className="flex items-center justify-between gap-1 border-b bg-background px-2 py-2.5 md:px-4">
              <button
                onClick={() => setSelectedId(null)}
                aria-label="Volver a los correos"
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-text-2 hover:bg-accent hover:text-foreground md:hidden"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-3 p-1">
                <ContactAvatar
                  name={selected.participant.name}
                  seed={selected.participant.email}
                  size="md"
                />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-bold leading-tight tracking-tight">
                    {selected.participant.name}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10.5px] tracking-[0.04em] text-text-3">
                    {selected.participant.email}
                  </p>
                </div>
              </div>
              <span className="ml-auto hidden max-w-[40%] min-w-0 truncate text-xs text-text-3 sm:block">
                {selected.subject}
              </span>
            </header>

            <div
              ref={scrollRef}
              className="thread-bg flex flex-1 flex-col gap-[3px] overflow-y-auto overscroll-contain px-3 py-5 sm:px-[6%]"
            >
              {selected.messages.map((m, i) => {
                const prev = selected.messages[i - 1];
                const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                const grouped = !newDay && prev !== undefined && prev.direction === m.direction;
                const out = m.direction === "outbound";
                return (
                  <div key={m.id}>
                    {newDay && (
                      <div className="my-3 flex justify-center">
                        <span className="kicker rounded-full border border-border-strong bg-background px-3 py-1 text-text-2 shadow-sm">
                          {dayLabel(m.createdAt)}
                        </span>
                      </div>
                    )}
                    <div className={cn("flex", out ? "justify-end" : "justify-start", grouped ? "mt-[3px]" : "mt-2.5")}>
                      <div className={cn(
                        "max-w-[85%] rounded-[14px] border px-3 pb-1.5 pt-2 text-[13.5px] leading-[1.45] shadow-sm sm:max-w-[64%]",
                        out ? "border-bubble-out-border bg-bubble-out text-bubble-out-text" : "border-bubble-in-border bg-bubble-in",
                        !grouped && (out ? "rounded-tr-[5px]" : "rounded-tl-[5px]"),
                      )}>
                        <span className="whitespace-pre-wrap break-words">{m.text ?? "(sin contenido)"}</span>
                        <span className="float-right ml-2 mt-1 font-mono text-[10px] tracking-[0.04em] text-text-3">
                          {bubbleTime(m.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Compositor en píldora, idéntico al de la Bandeja */}
            <div className="border-t bg-background px-[18px] pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3">
              {replyAttachments.length > 0 && (
                <div className="mb-2.5 space-y-1.5">
                  {replyAttachments.map((a, i) => (
                    <div key={i} className="flex items-center gap-2.5 rounded-md border bg-subtle p-2.5">
                      <Paperclip className="h-5 w-5 shrink-0 text-brand" strokeWidth={1.5} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.filename}</span>
                      <button
                        type="button"
                        onClick={() => setReplyAttachments((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={`Quitar ${a.filename}`}
                        className="flex min-h-11 min-w-11 items-center justify-center rounded text-text-3 hover:bg-secondary hover:text-foreground"
                      >
                        <X className="h-4 w-4" strokeWidth={1.7} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2 rounded-[23px] border border-border-strong bg-background py-1.5 pl-2 pr-1.5 shadow-sm transition-[border-color,box-shadow] focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft">
                <input
                  ref={replyFileRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                  multiple
                  className="hidden"
                  onChange={(e) => void handleReplyFiles(e)}
                />
                <button
                  onClick={() => replyFileRef.current?.click()}
                  aria-label="Adjuntar archivo"
                  title="Adjuntar archivo"
                  className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-text-3 transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.7} />
                </button>
                <textarea
                  ref={taRef}
                  rows={1}
                  value={replyBody}
                  onFocus={(event) => {
                    const textarea = event.currentTarget;
                    window.setTimeout(() => textarea.scrollIntoView({ block: "nearest" }), 120);
                  }}
                  onChange={(e) => {
                    setReplyBody(e.target.value);
                    autogrow();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendReply();
                    }
                  }}
                  placeholder={`Responder a ${selected.participant.name}…`}
                  className="max-h-[120px] min-w-0 flex-1 resize-none self-center bg-transparent py-1 text-sm leading-relaxed outline-none placeholder:text-text-3"
                />
                <button
                  onClick={() => void sendReply()}
                  disabled={sending || !replyBody.trim()}
                  aria-label="Enviar"
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg transition-[opacity,background-color] hover:bg-brand-hover",
                    (sending || !replyBody.trim()) && "opacity-40"
                  )}
                >
                  <Send className="h-4 w-4" strokeWidth={1.7} />
                </button>
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                {error ? <p className="text-xs text-destructive">{error}</p> : <span />}
                <p className="font-mono text-[10.5px] tracking-[0.04em] text-text-3">
                  Enter para enviar · Shift + Enter nueva línea
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="thread-bg flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="font-serif text-[24px] italic leading-tight text-text-2">
              Elige una conversación para ver el hilo
            </p>
            <p className="kicker">
              <Mail className="mr-1 inline h-3 w-3 align-[-2px]" strokeWidth={1.8} />
              Buzón · correo entrante
            </p>
          </div>
        )}
      </section>

      {composeOpen && accountId && (
        <EmailComposeDialog
          accountId={accountId}
          onClose={() => setComposeOpen(false)}
          onSent={() => { void refetch({ silent: true }); void syncMail(); }}
        />
      )}
    </div>
  );
}
