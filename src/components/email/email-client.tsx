"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import {
  Archive,
  ArrowLeft,
  Mail,
  MoreHorizontal,
  Paperclip,
  Pencil,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NewAccountDialog } from "./new-account-dialog";
import Link from "next/link";

type EmailAccount = {
  id: string;
  label: string | null;
  email: string;
  enabled: boolean;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  username: string;
};

type EmailMessage = {
  id: string;
  from: string;
  messageId: string;
  to: { value: Array<{ address: string; name: string }> };
  subject: string;
  bodyText: string;
  createdAt: string;
  seen: boolean;
};

function getInitials(name: string): string {
  return name
    .replace(/["<>]/g, "")
    .split(/[@\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
    "bg-rose-500", "bg-cyan-500", "bg-indigo-500", "bg-pink-500",
  ];
  let hash = 0;
  for (const ch of name) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length]!;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) {
    return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) {
    return d.toLocaleDateString("es-MX", { weekday: "short" });
  }
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

function getPreview(text: string, max = 80): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "..." : clean;
}

export function EmailClient({ settingsOnly = false }: { settingsOnly?: boolean }) {
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<EmailAccount | undefined>();
  const [testing, setTesting] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<string | null>(null);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncCount, setSyncCount] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState("");
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<{ filename: string; content: string; contentType: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const refetchAccounts = useCallback(async () => {
    const res = await fetch("/api/email/accounts").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { accounts: EmailAccount[] };
    setAccounts(data.accounts);
  }, []);

  const refetchMessages = useCallback(async (accountId: string) => {
    const res = await fetch(`/api/email/messages?accountId=${accountId}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { messages: EmailMessage[] };
    setMessages(data.messages);
  }, []);

  useEffect(() => { void refetchAccounts(); }, [refetchAccounts]);

  useEffect(() => {
    if (selectedAccount) {
      setMessages([]);
      setSelectedMessage(null);
      void refetchMessages(selectedAccount);
    }
  }, [selectedAccount, refetchMessages]);

  const handleSync = async () => {
    if (!selectedAccount) return;
    setSyncing(true);
    setError("");
    setSyncCount(null);
    const res = await fetch(`/api/email/accounts/${selectedAccount}/sync`, { method: "POST" }).catch(() => null);
    setSyncing(false);
    if (res?.ok) {
      const data = (await res.json()) as { synced: number };
      setSyncCount(data.synced);
      void refetchMessages(selectedAccount);
    } else setError("No se pudo sincronizar.");
  };

  const handleSelectMessage = (id: string) => {
    setSelectedMessage(id);
    setShowReply(false);
    void fetch(`/api/email/messages/${id}`, { method: "PATCH" }).then((res) => {
      if (res.ok) setMessages((prev) => prev.map((m) => m.id === id ? { ...m, seen: true } : m));
    });
  };

  const handleBack = () => { setSelectedMessage(null); setShowReply(false); };

  const handleOpenReply = () => {
    const msg = messages.find((m) => m.id === selectedMessage);
    if (!msg) return;
    setReplyTo(msg.from);
    setReplySubject(msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`);
    setReplyBody("");
    setAttachments([]);
    setShowReply(true);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newAttachments: { filename: string; content: string; contentType: string }[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) { setError(`El archivo ${file.name} supera 10MB`); continue; }
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      newAttachments.push({ filename: file.name, content: base64, contentType: file.type || "application/octet-stream" });
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    setSending(true);
    setError("");
    const response = await fetch("/api/email/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: selectedAccount,
        to: replyTo,
        subject: replySubject,
        text: replyBody,
        inReplyTo: messages.find((m) => m.id === selectedMessage)?.messageId,
        attachments: attachments.length > 0 ? attachments : undefined,
      }),
    }).catch(() => null);
    setSending(false);
    if (!response?.ok) { setError("No se pudo enviar el correo."); return; }
    void refetchMessages(selectedAccount);
    setShowReply(false);
    setReplyTo("");
    setReplySubject("");
    setReplyBody("");
    setAttachments([]);
  };

  const filteredMessages = messages.filter((msg) => {
    if (filter === "unread" && msg.seen) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return `${msg.subject} ${msg.from}`.toLowerCase().includes(q);
    }
    return true;
  });

  const selectedMsg = messages.find((m) => m.id === selectedMessage);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ═══ TOP BAR ═══ */}
      <header className="flex items-center gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-semibold tracking-tight">Correo</span>
        </div>
        {selectedAccount && (
          <div className="relative ml-4 flex-1 max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Buscar en el correo"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-full border bg-muted/50 py-2 pl-10 pr-4 text-sm outline-none transition-colors focus:border-blue-400 focus:bg-white focus:shadow-sm dark:focus:bg-gray-800"
            />
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          {selectedAccount && (
            <>
              <Button variant="ghost" size="sm" onClick={handleSync} disabled={syncing} className="rounded-full">
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              </Button>
              {syncCount !== null && (
                <span className="text-xs text-muted-foreground mr-2">{syncCount} nuevos</span>
              )}
            </>
          )}
          <Link href="/settings/email" className="text-xs text-muted-foreground hover:text-foreground">
            Configurar
          </Link>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ═══ LEFT SIDEBAR ═══ */}
        <aside className="flex w-[260px] shrink-0 flex-col border-r">
          <div className="p-3">
            <Button
              className="w-full justify-start gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 shadow-sm"
              onClick={() => { setEditing(undefined); setShowNewAccount(true); }}
            >
              <Pencil className="h-4 w-4" />
              Redactar
            </Button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2">
            <button
              onClick={() => setSelectedAccount(null)}
              className={`mb-0.5 flex w-full items-center gap-3 rounded-full px-3 py-2 text-sm transition-colors hover:bg-muted ${!selectedAccount ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "text-foreground"}`}
            >
              <Mail className="h-4 w-4" />
              Bandeja de entrada
            </button>

            <div className="my-3 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Cuentas
            </div>

            {accounts.length === 0 && (
              <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                Sin cuentas configuradas
              </p>
            )}

            {accounts.map((acc) => (
              <div key={acc.id}>
                <button
                  onClick={() => setSelectedAccount(acc.id)}
                  className={`flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-sm transition-colors hover:bg-muted ${selectedAccount === acc.id ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300" : ""}`}
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                    {getInitials(acc.email)}
                  </div>
                  <span className="truncate">{acc.label ?? acc.email.split("@")[0]}</span>
                  <Badge variant={acc.enabled ? "success" : "secondary"} className="ml-auto shrink-0 text-[9px]">
                    {acc.enabled ? "On" : "Off"}
                  </Badge>
                </button>
                {settingsOnly && (
                  <div className="flex gap-1 px-3 pb-2">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => { setEditing(acc); setShowNewAccount(true); }}>Editar</Button>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px]" disabled={!!testing} onClick={async () => {
                      setTesting(acc.id); setError("");
                      const res = await fetch(`/api/email/accounts/${acc.id}/test`, { method: "POST" }).catch(() => null);
                      setError(res?.ok ? "Conexion verificada" : "Fallo la conexion.");
                      setTesting(null);
                    }}>{testing === acc.id ? "Probando..." : "Probar"}</Button>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] text-destructive" onClick={async () => {
                      const res = await fetch(`/api/email/accounts/${acc.id}`, { method: "DELETE" }).catch(() => null);
                      if (res?.ok) void refetchAccounts(); else setError("No se pudo eliminar");
                    }}>Eliminar</Button>
                  </div>
                )}
              </div>
            ))}
          </nav>
        </aside>

        {/* ═══ MAIN CONTENT ═══ */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {error && (
            <div className="mx-4 mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
              <button onClick={() => setError("")} className="ml-2 text-red-500 hover:text-red-700"><X className="inline h-3 w-3" /></button>
            </div>
          )}

          {settingsOnly && (
            <div className="p-4 text-sm text-muted-foreground">
              Configura tus cuentas IMAP/SMTP. Consulta y responde en{" "}
              <Link className="text-blue-600 underline" href="/inbox?channel=email">Bandeja → Buzon</Link>.
            </div>
          )}

          {/* ═══ MESSAGE LIST ═══ */}
          {!settingsOnly && selectedAccount && !selectedMessage && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Toolbar */}
              <div className="flex items-center gap-2 border-b px-4 py-2">
                <div className="flex items-center gap-1">
                  <input type="checkbox" className="h-4 w-4 accent-blue-600" />
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} onClick={handleSync} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="rounded-full border bg-transparent px-3 py-1 text-xs text-muted-foreground"
                  >
                    <option value="all">Todos</option>
                    <option value="unread">No leidos</option>
                  </select>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto">
                {filteredMessages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                      <Mail className="h-10 w-10 text-muted-foreground/50" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {messages.length === 0 ? "No hay mensajes" : "Sin resultados"}
                    </p>
                    <p className="max-w-xs text-xs text-muted-foreground/70">
                      {messages.length === 0
                        ? "Presiona sincronizar para obtener correos de tu bandeja."
                        : "No hay correos que coincidan con tu busqueda."}
                    </p>
                  </div>
                ) : (
                  filteredMessages.map((msg) => (
                    <button
                      key={msg.id}
                      onClick={() => handleSelectMessage(msg.id)}
                      className={`flex w-full items-start gap-3 border-b border-transparent px-4 py-3 text-left transition-colors hover:bg-muted/50 ${!msg.seen ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`}
                    >
                      {/* Checkbox */}
                      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-blue-600" onClick={(e) => e.stopPropagation()} />

                      {/* Star */}
                      <button className="mt-0.5 shrink-0 text-muted-foreground/30 hover:text-amber-400" onClick={(e) => e.stopPropagation()}>
                        <Star className="h-4 w-4" />
                      </button>

                      {/* Avatar */}
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${getAvatarColor(msg.from)}`}>
                        {getInitials(msg.from)}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className={`truncate text-sm ${!msg.seen ? "font-semibold" : "font-medium"}`}>
                            {msg.from.replace(/["<>]/g, "").split("@")[0]}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {formatTime(msg.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className={`truncate text-sm ${!msg.seen ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                            {msg.subject}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                          {getPreview(msg.bodyText)}
                        </p>
                      </div>

                      {/* Unread dot */}
                      {!msg.seen && (
                        <div className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600" />
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ═══ MESSAGE DETAIL ═══ */}
          {!settingsOnly && selectedMessage && selectedMsg && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Detail header */}
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleBack}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-semibold">{selectedMsg.subject}</h2>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleOpenReply}>
                    <Reply className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <ReplyAll className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Archive className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Sender info */}
              <div className="flex items-start gap-3 px-6 py-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${getAvatarColor(selectedMsg.from)}`}>
                  {getInitials(selectedMsg.from)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">{selectedMsg.from}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(selectedMsg.createdAt).toLocaleString("es-MX", {
                        weekday: "short", day: "numeric", month: "short",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Para: {selectedMsg.to.value.map((r) => r.address).join(", ")}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {selectedMsg.bodyText}
                </div>
              </div>

              {/* Quick reply bar */}
              <div className="border-t px-6 py-3">
                <button
                  onClick={handleOpenReply}
                  className="w-full rounded-lg border bg-muted/30 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60"
                >
                  Responder...
                </button>
              </div>
            </div>
          )}

          {/* ═══ EMPTY STATE ═══ */}
          {!settingsOnly && !selectedAccount && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-muted">
                <Mail className="h-12 w-12 text-muted-foreground/40" />
              </div>
              <div>
                <p className="text-lg font-medium text-foreground">Selecciona una cuenta</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Elige una cuenta de la izquierda para ver tus correos
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ═══ REPLY MODAL ═══ */}
      {showReply && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <button aria-label="Cerrar" onClick={() => setShowReply(false)} className="absolute inset-0 bg-black/30" />
          <div className="relative z-10 w-full max-w-2xl rounded-t-2xl border bg-card shadow-2xl sm:rounded-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-sm font-semibold">Nuevo mensaje</h2>
              <button onClick={() => setShowReply(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSendReply} className="flex flex-col">
              <div className="flex items-center gap-2 border-b px-5 py-2.5">
                <Label className="w-12 text-xs text-muted-foreground">Para</Label>
                <Input
                  type="email"
                  required
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  className="border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="flex items-center gap-2 border-b px-5 py-2.5">
                <Label className="w-12 text-xs text-muted-foreground">Asunto</Label>
                <Input
                  required
                  value={replySubject}
                  onChange={(e) => setReplySubject(e.target.value)}
                  className="border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                />
              </div>

              <textarea
                required
                rows={10}
                placeholder="Escribe tu mensaje..."
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                className="min-h-[200px] resize-none border-0 bg-transparent px-5 py-3 text-sm outline-none placeholder:text-muted-foreground/50"
              />

              {/* Attachments */}
              {attachments.length > 0 && (
                <div className="border-t px-5 py-2">
                  <ul className="space-y-1">
                    {attachments.map((a, i) => (
                      <li key={i} className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs">
                        <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{a.filename}</span>
                        <button type="button" onClick={() => removeAttachment(i)} className="text-muted-foreground hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Modal footer */}
              <div className="flex items-center justify-between border-t px-5 py-3">
                <div className="flex items-center gap-1">
                  <Button type="submit" disabled={sending} className="rounded-full bg-blue-600 px-6 text-white hover:bg-blue-700">
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                    {sending ? "Enviando..." : "Enviar"}
                  </Button>
                  <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" multiple className="hidden" onChange={(e) => void handleFileChange(e)} />
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => fileInputRef.current?.click()}>
                    <Paperclip className="h-4 w-4" />
                  </Button>
                </div>
                <button type="button" onClick={() => setShowReply(false)} className="text-xs text-muted-foreground hover:text-foreground">
                  Descartar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewAccount && (
        <NewAccountDialog
          key={editing?.id ?? "new"}
          initial={editing}
          open={showNewAccount}
          onClose={() => setShowNewAccount(false)}
          onCreated={() => { setShowNewAccount(false); void refetchAccounts(); }}
        />
      )}
    </div>
  );
}
