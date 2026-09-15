"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { Mail, RefreshCw, Plus, ArrowLeft, Send, Paperclip, X } from "lucide-react";
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

  const refetchAccounts = useCallback(async () => {
    const res = await fetch("/api/email/accounts").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { accounts: EmailAccount[] };
    setAccounts(data.accounts);
  }, []);

  const refetchMessages = useCallback(async (accountId: string) => {
    const res = await fetch(`/api/email/messages?accountId=${accountId}`).catch(
      () => null
    );
    if (!res?.ok) return;
    const data = (await res.json()) as { messages: EmailMessage[] };
    setMessages(data.messages);
  }, []);

  useEffect(() => {
    void refetchAccounts();
  }, [refetchAccounts]);

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
    const res = await fetch(`/api/email/accounts/${selectedAccount}/sync`, {
      method: "POST",
    }).catch(() => null);
    setSyncing(false);
    if (res?.ok) {
      const data = (await res.json()) as { synced: number };
      setSyncCount(data.synced);
      void refetchMessages(selectedAccount);
    } else setError("No se pudo sincronizar. Revisa la conexión en Ajustes → Buzón.");
  };

  const handleSelectAccount = (id: string) => {
    setSelectedAccount(id);
  };

  const handleSelectMessage = (id: string) => {
    setSelectedMessage(id);
    setShowReply(false);
    void fetch(`/api/email/messages/${id}`, { method: "PATCH" }).then((res) => { if (res.ok) setMessages((previous) => previous.map((m) => m.id === id ? { ...m, seen: true } : m)); });
  };

  const handleBack = () => {
    setSelectedMessage(null);
    setShowReply(false);
  };

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
        inReplyTo: messages.find((message) => message.id === selectedMessage)?.messageId,
        attachments: attachments.length > 0 ? attachments : undefined,
      }),
    }).catch(() => null);
    setSending(false);
    if (!response?.ok) { setError("No se pudo enviar el correo. Tu mensaje sigue disponible para reintentar."); return; }
    void refetchMessages(selectedAccount);
    setShowReply(false);
    setReplyTo("");
    setReplySubject("");
    setReplyBody("");
    setAttachments([]);
  };

  const selectedMsg = messages.find((m) => m.id === selectedMessage);

  return (
    <div className="flex h-full flex-col overflow-auto md:flex-row">
      <aside className="w-full shrink-0 overflow-auto border-r md:w-[280px] lg:w-[320px]">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h1 className="text-lg font-bold">Cuentas</h1>
          {settingsOnly ? <Button
            variant="secondary"
            size="sm"
            onClick={() => { setEditing(undefined); setShowNewAccount(true); }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Nueva Cuenta
          </Button> : <Link className="text-sm underline" href="/settings/email">Configurar</Link>}
        </div>
        <div className="flex flex-col">
          {accounts.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-text-2">
              No hay cuentas configuradas
            </p>
          )}
          {accounts.map((acc) => (
            <div key={acc.id}>
            <button
              key={acc.id}
              onClick={() => handleSelectAccount(acc.id)}
              className={`flex flex-col gap-0.5 border-b px-4 py-3 text-left transition-colors hover:bg-accent ${
                selectedAccount === acc.id ? "bg-accent" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0 text-text-3" />
                <span className="truncate text-sm font-medium">
                  {acc.label ?? acc.email}
                </span>
                <Badge
                  variant={acc.enabled ? "success" : "secondary"}
                  className="ml-auto shrink-0 text-[10px]"
                >
                  {acc.enabled ? "Habilitada" : "Deshabilitada"}
                </Badge>
              </div>
              <span className="truncate pl-6 text-xs text-text-3">
                {acc.email}
              </span>
            </button>
            {settingsOnly && <div className="flex flex-wrap gap-1 p-2">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(acc); setShowNewAccount(true); }}>Editar</Button>
            <Button variant="ghost" size="sm" disabled={!!testing} onClick={async () => { setTesting(acc.id); setError(""); const res = await fetch(`/api/email/accounts/${acc.id}/test`, { method: "POST" }).catch(() => null); setError(res?.ok ? "Conexión IMAP/SMTP verificada" : "Falló la conexión. Revisa servidores, puertos y contraseña."); setTesting(null); }}>{testing === acc.id ? "Probando…" : "Probar conexión"}</Button>
            <Button variant="ghost" size="sm" onClick={async () => {
              const res = await fetch(`/api/email/accounts/${acc.id}`, { method: "DELETE" }).catch(() => null);
              if (res?.ok) void refetchAccounts(); else setError("No se pudo eliminar la cuenta");
            }}>Eliminar cuenta</Button></div>}
            </div>
          ))}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {error && <p role="alert" className="p-3 text-destructive">{error}</p>}
        {settingsOnly && <p className="p-4 text-sm">Configura tus cuentas IMAP/SMTP. Consulta y responde tus mensajes en <Link className="underline" href="/inbox?channel=email">Bandeja → Buzón</Link>.</p>}
        {!settingsOnly && selectedAccount && !selectedMessage && (
          <>
            <header className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-bold">
                Mensajes de{" "}
                {accounts.find((a) => a.id === selectedAccount)?.label ??
                  accounts.find((a) => a.id === selectedAccount)?.email}
              </h2>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => { setReplyTo(""); setReplySubject(""); setReplyBody(""); setAttachments([]); setShowReply(true); }}>Redactar</Button>
                {syncCount !== null && (
                  <span className="text-xs text-text-3">
                    {syncCount} sincronizados
                  </span>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSync}
                  disabled={syncing}
                >
                  <RefreshCw
                    className={`mr-1 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
                  />
                  {syncing ? "Sincronizando..." : "Sincronizar"}
                </Button>
              </div>
            </header>
            <div className="flex flex-col">
              <Input aria-label="Buscar correo" placeholder="Buscar remitente o asunto" value={query} onChange={(e) => setQuery(e.target.value)} />
              <select aria-label="Filtrar correos" className="rounded border bg-background p-2" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Todos</option><option value="unread">No leídos</option></select>
              {messages.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-text-2">
                  No hay mensajes. Presiona sincronizar para obtener correos.
                </p>
              )}
              {messages.filter((msg) => (filter !== "unread" || !msg.seen) && `${msg.subject} ${msg.from}`.toLowerCase().includes(query.toLowerCase())).map((msg) => (
                <button
                  key={msg.id}
                  onClick={() => handleSelectMessage(msg.id)}
                  className={`flex flex-col gap-0.5 border-b px-4 py-3 text-left transition-colors hover:bg-accent`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm ${msg.seen ? "font-normal text-text-2" : "font-bold"}`}
                    >
                      {msg.subject}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="truncate text-xs text-text-3">
                      {msg.from}
                    </span>
                    <span className="shrink-0 text-xs text-text-3">
                      {new Date(msg.createdAt).toLocaleDateString("es-MX")}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {!settingsOnly && selectedMessage && selectedMsg && (
          <>
            <header className="flex items-center gap-3 border-b px-4 py-3">
              <button
                onClick={handleBack}
                className="rounded-md p-1 text-text-2 hover:bg-accent hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-bold">
                  {selectedMsg.subject}
                </h2>
                <p className="truncate text-xs text-text-3">{selectedMsg.from}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={handleOpenReply}>
                <Send className="mr-1 h-3.5 w-3.5" />
                Responder
              </Button>
            </header>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-4 flex flex-col gap-1 border-b pb-4">
                <div className="flex gap-2 text-xs">
                  <span className="font-medium text-text-2">De:</span>
                  <span>{selectedMsg.from}</span>
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="font-medium text-text-2">Para:</span>
                  <span>{selectedMsg.to.value.map((recipient) => recipient.address).join(", ")}</span>
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="font-medium text-text-2">Asunto:</span>
                  <span>{selectedMsg.subject}</span>
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="font-medium text-text-2">Fecha:</span>
                  <span>
                    {new Date(selectedMsg.createdAt).toLocaleString("es-MX")}
                  </span>
                </div>
              </div>
              <div className="whitespace-pre-wrap text-sm">
                {selectedMsg.bodyText}
              </div>
            </div>
          </>
        )}

        {!settingsOnly && !selectedAccount && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <Mail className="h-12 w-12 text-text-3" />
            <p className="text-lg font-medium text-text-2">
              Selecciona una cuenta para ver los correos
            </p>
          </div>
        )}

        {showReply && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <button
              aria-label="Cerrar"
              onClick={() => setShowReply(false)}
              className="absolute inset-0 bg-overlay"
            />
            <div className="relative z-10 w-full max-w-lg rounded-lg border border-border-strong bg-card p-6 shadow-lg">
              <h2 className="mb-4 text-lg font-bold">Correo</h2>
              {error && <p role="alert" className="text-destructive">{error}</p>}
              <form onSubmit={handleSendReply} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Para</Label>
                  <Input aria-label="Para" type="email" required value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Asunto</Label>
                  <Input aria-label="Asunto" required value={replySubject} onChange={(e) => setReplySubject(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reply-body">Mensaje *</Label>
                  <textarea
                    id="reply-body"
                    required
                    rows={6}
                    className="rounded-md border border-border-strong bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Adjuntos (PDF, máx 10MB c/u)</Label>
                  <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" multiple className="hidden" onChange={(e) => void handleFileChange(e)} />
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Paperclip className="mr-1.5 h-3.5 w-3.5" /> Adjuntar archivo
                  </Button>
                  {attachments.length > 0 && (
                    <ul className="mt-1 space-y-1">
                      {attachments.map((a, i) => (
                        <li key={i} className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs">
                          <Paperclip className="h-3 w-3 shrink-0" />
                          <span className="flex-1 truncate">{a.filename}</span>
                          <span className="text-muted-foreground">{(a.content.length * 0.75 / 1024).toFixed(0)}KB</span>
                          <button type="button" onClick={() => removeAttachment(i)} className="shrink-0 text-muted-foreground hover:text-destructive">
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowReply(false)}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={sending}>
                    {sending ? "Enviando..." : "Enviar"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>

      {showNewAccount && <NewAccountDialog
        key={editing?.id ?? "new"}
        initial={editing}
        open={showNewAccount}
        onClose={() => setShowNewAccount(false)}
        onCreated={() => {
          setShowNewAccount(false);
          void refetchAccounts();
        }}
      />}
    </div>
  );
}
