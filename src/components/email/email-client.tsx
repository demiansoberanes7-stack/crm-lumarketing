"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, RefreshCw, Plus, ArrowLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NewAccountDialog } from "./new-account-dialog";

type EmailAccount = {
  id: string;
  label: string | null;
  email: string;
  enabled: boolean;
  imapHost: string;
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

export function EmailClient() {
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
    setSyncCount(null);
    const res = await fetch(`/api/email/accounts/${selectedAccount}/sync`, {
      method: "POST",
    }).catch(() => null);
    setSyncing(false);
    if (res?.ok) {
      const data = (await res.json()) as { synced: number };
      setSyncCount(data.synced);
      void refetchMessages(selectedAccount);
    }
  };

  const handleSelectAccount = (id: string) => {
    setSelectedAccount(id);
  };

  const handleSelectMessage = (id: string) => {
    setSelectedMessage(id);
    setShowReply(false);
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
    setShowReply(true);
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    setSending(true);
    await fetch("/api/email/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accountId: selectedAccount,
        to: replyTo,
        subject: replySubject,
        text: replyBody,
        inReplyTo: messages.find((message) => message.id === selectedMessage)?.messageId,
      }),
    }).catch(() => null);
    setSending(false);
    setShowReply(false);
    setReplyTo("");
    setReplySubject("");
    setReplyBody("");
  };

  const selectedMsg = messages.find((m) => m.id === selectedMessage);

  return (
    <div className="flex h-full">
      <aside className="w-full shrink-0 overflow-hidden border-r md:w-[280px] lg:w-[320px]">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h1 className="text-lg font-bold">Cuentas</h1>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowNewAccount(true)}
          >
            <Plus className="mr-1 h-4 w-4" />
            Nueva Cuenta
          </Button>
        </div>
        <div className="flex flex-col">
          {accounts.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-text-2">
              No hay cuentas configuradas
            </p>
          )}
          {accounts.map((acc) => (
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
          ))}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {selectedAccount && !selectedMessage && (
          <>
            <header className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-bold">
                Mensajes de{" "}
                {accounts.find((a) => a.id === selectedAccount)?.label ??
                  accounts.find((a) => a.id === selectedAccount)?.email}
              </h2>
              <div className="flex items-center gap-2">
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
              {messages.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-text-2">
                  No hay mensajes. Presiona sincronizar para obtener correos.
                </p>
              )}
              {messages.map((msg) => (
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

        {selectedMessage && selectedMsg && (
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

        {!selectedAccount && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <Mail className="h-12 w-12 text-text-3" />
            <p className="text-lg font-medium text-text-2">
              Selecciona una cuenta para ver los correos
            </p>
          </div>
        )}

        {showReply && selectedMsg && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <button
              aria-label="Cerrar"
              onClick={() => setShowReply(false)}
              className="absolute inset-0 bg-overlay"
            />
            <div className="relative z-10 w-full max-w-lg rounded-lg border border-border-strong bg-card p-6 shadow-lg">
              <h2 className="mb-4 text-lg font-bold">Responder</h2>
              <form onSubmit={handleSendReply} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Para</Label>
                  <Input value={replyTo} readOnly />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Asunto</Label>
                  <Input value={replySubject} readOnly />
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

      <NewAccountDialog
        open={showNewAccount}
        onClose={() => setShowNewAccount(false)}
        onCreated={() => {
          setShowNewAccount(false);
          void refetchAccounts();
        }}
      />
    </div>
  );
}
