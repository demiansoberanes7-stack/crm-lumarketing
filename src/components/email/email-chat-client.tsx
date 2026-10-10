"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Mail, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { EmailChatThread } from "@/app/api/email/threads/route";

type EmailAccount = { id: string; label: string | null; email: string; enabled: boolean };

function initials(name: string): string {
  return name.replace(/["<>]/g, "").split(/[@\s]+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function previewTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days === 0) return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Ayer";
  if (days < 7) return d.toLocaleDateString("es-MX", { weekday: "short" });
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

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

export function EmailChatClient() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [threads, setThreads] = useState<EmailChatThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [mobileList, setMobileList] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const refetch = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
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

  const selected = threads.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selectedId, selected?.messages.length]);

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
        inReplyTo: last?.from === selected.participant.email ? last.id : null,
      }),
    }).catch(() => null);
    setSending(false);
    if (res?.ok) {
      setReplyBody("");
      await refetch();
    } else {
      const data = await res?.json().catch(() => null);
      setError(data?.error?.message ?? "No se pudo enviar la respuesta.");
    }
  }

  if (accounts.length > 1 && !accountId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Elige una cuenta de correo para ver sus conversaciones.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ═══ LISTA DE HILOS ═══ */}
      <aside className={cn(
        "flex w-full flex-col border-r sm:w-[320px] sm:shrink-0",
        mobileList && selected ? "hidden sm:flex" : "flex",
      )}>
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <select
            value={accountId ?? ""}
            onChange={(e) => { setAccountId(e.target.value); setSelectedId(null); }}
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
            aria-label="Cuenta de correo"
          >
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label ?? a.email}</option>)}
          </select>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void refetch()} aria-label="Actualizar">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {threads.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <Mail className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Sin conversaciones de correo.</p>
            </div>
          ) : threads.map((t) => (
            <button
              key={t.id}
              onClick={() => { setSelectedId(t.id); setMobileList(false); }}
              className={cn(
                "flex w-full items-start gap-3 border-b px-3 py-3 text-left transition-colors hover:bg-accent/50",
                selectedId === t.id && "bg-brand-tint/40",
                t.unread && "bg-accent/30",
              )}
            >
              <span className={cn(
                "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white",
                t.unread ? "bg-brand" : "bg-text-3",
              )}>
                {initials(t.participant.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{t.participant.name}</span>
                  <span className="shrink-0 text-[11px] text-text-3">{previewTime(t.latestAt)}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-text-3">{t.subject}</span>
                <span className="mt-0.5 block truncate text-xs text-text-3">
                  {t.messages[t.messages.length - 1]?.text?.replace(/\s+/g, " ").slice(0, 80) ?? "(sin contenido)"}
                </span>
              </span>
              {t.unread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />}
            </button>
          ))}
        </div>
      </aside>

      {/* ═══ HILO EN CHAT ═══ */}
      <section className={cn(
        "flex min-w-0 flex-1 flex-col",
        mobileList && !selected ? "hidden sm:flex" : "flex",
      )}>
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <Mail className="h-8 w-8 text-muted-foreground/40" />
            Selecciona una conversación para leerla y responder.
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b px-4 py-3">
              <button className="sm:hidden" onClick={() => { setMobileList(true); setSelectedId(null); }} aria-label="Volver">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand text-[11px] font-bold text-white">
                {initials(selected.participant.name)}
              </span>
              <span className="min-w-0">
                <p className="truncate text-sm font-semibold">{selected.participant.name}</p>
                <p className="truncate text-xs text-text-3">{selected.subject}</p>
              </span>
              <span className="ml-auto shrink-0 text-xs text-text-3">{selected.participant.email}</span>
            </header>

            {error && (
              <div role="alert" className="mx-4 mt-3 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div ref={scrollRef} className="thread-bg flex flex-1 flex-col gap-[3px] overflow-y-auto px-3 py-5 sm:px-[6%]">
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

            <div className="border-t p-3">
              <div className="flex items-end gap-2">
                <Textarea
                  rows={2}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void sendReply();
                  }}
                  placeholder={`Responder a ${selected.participant.name}…`}
                  className="min-h-[44px] flex-1 resize-none"
                />
                <Button onClick={() => void sendReply()} disabled={sending || !replyBody.trim()} className="h-[44px]">
                  <Send className="mr-1.5 h-4 w-4" /> {sending ? "Enviando…" : "Enviar"}
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-text-3">Ctrl/Cmd + Enter para enviar.</p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
