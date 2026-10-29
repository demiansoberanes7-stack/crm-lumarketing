"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, Pencil, X, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PdfActions } from "@/components/pdf-actions";
import { NewQuoteDialog } from "./new-quote-dialog";
import { QuoteItem, STATUS_LABELS, STATUS_VARIANT, formatMXNCents, formatDate } from "./shared";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import type { ConversationDto } from "@/lib/types";
import { formatRemaining } from "@/components/inbox/helpers";

/** Canales por los que puede salir una cotización (mismos que acepta la API). */
const SEND_CHANNELS = ["whatsapp", "instagram", "messenger"] as const;
type SendChannel = (typeof SEND_CHANNELS)[number];

/** Cuenta de correo, tal como la devuelve /api/email/accounts. */
interface EmailAccountLite {
  id: string;
  label: string;
  email: string;
  enabled: boolean;
}

/** Hilo del buzón, tal como lo devuelve /api/email/threads. */
interface EmailThreadLite {
  id: string;
  subject: string;
  participant: { name: string; email: string };
  /** En orden cronológico: el último es el mensaje al que se responde. */
  messages: { id: string; direction: "inbound" | "outbound" }[];
  latestAt: string;
}

/** Lo que elige el operador en el desplegable: un chat o un hilo de correo. */
type SendChoice =
  | { kind: "chat"; channel: SendChannel; conversationId: string }
  | { kind: "email"; emailAccountId: string; emailMessageId: string; contactName: string };

/** Opciones de correo aplanadas, con el id del mensaje más reciente del hilo. */
interface MailOption {
  value: string;
  accountId: string;
  accountEmail: string;
  accountLabel: string;
  messageId: string;
  participantName: string;
  subject: string;
}

const MAIL_PREFIX = "mail:";

function mailValue(accountId: string, messageId: string): string {
  return `${MAIL_PREFIX}${accountId}|${messageId}`;
}

/**
 * Decodifica el valor del desplegable. Los ids son opacos, así que se valida
 * que la opción siga existiendo: si el chat o el hilo ya no está, no se envía.
 */
function parseChoice(
  value: string,
  chats: ConversationDto[],
  mails: MailOption[]
): SendChoice | null {
  if (!value) return null;
  if (value.startsWith(MAIL_PREFIX)) {
    const mail = mails.find((m) => m.value === value);
    return mail
      ? {
          kind: "email",
          emailAccountId: mail.accountId,
          emailMessageId: mail.messageId,
          contactName: mail.participantName,
        }
      : null;
  }
  const chat = chats.find((c) => c.id === value);
  if (!chat || !SEND_CHANNELS.includes(chat.channel as SendChannel)) return null;
  return { kind: "chat", channel: chat.channel as SendChannel, conversationId: chat.id };
}

interface QuoteData {
  id: string;
  quoteNumber: string;
  status: string;
  total: number;
  currency: string;
  items: QuoteItem[];
  subtotal: number;
  discountType: string | null;
  discountValue: number | null;
  taxRate: number;
  taxAmount: number;
  validUntil: string | null;
  createdAt: string;
  contactName: string | null;
  contactId: string | null;
  /** Teléfono impreso en la cotización (el del contacto es solo el respaldo). */
  clientPhone: string | null;
  contactPhone: string | null;
  message: string | null;
  discountAmount: number;
  paymentMethod: Record<string, unknown> | null;
}

function getStoredName(quoteId: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(`quote_name_${quoteId}`) ?? fallback;
}

export function QuoteDetail({
  quoteId,
  onClose,
  onUpdated,
}: {
  quoteId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [chatsFailed, setChatsFailed] = useState(false);
  const [chatId, setChatId] = useState<string>("");
  const [emailAccounts, setEmailAccounts] = useState<EmailAccountLite[]>([]);
  const [threadsByAccount, setThreadsByAccount] = useState<Record<string, EmailThreadLite[]>>({});
  const [mailFailed, setMailFailed] = useState(false);

  const reloadChats = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { conversations?: ConversationDto[] };
      setConversations(Array.isArray(data.conversations) ? data.conversations : []);
      setChatsFailed(false);
    } catch {
      // Un 500 vaciaba el selector «Enviar a» y la pantalla aseguraba «no hay
      // chats conectados»: el chat sí estaba en la bandeja, la lectura no llegó.
      setChatsFailed(true);
    }
  }, []);

  const reloadMail = useCallback(async () => {
    try {
      const res = await fetch("/api/email/accounts");
      // 403 es legítimo: quien mira no es owner y simplemente no ve correo.
      if (res.status === 403) {
        setEmailAccounts([]);
        setThreadsByAccount({});
        setMailFailed(false);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { accounts?: EmailAccountLite[] };
      if (!Array.isArray(data.accounts)) throw new Error("respuesta inesperada");
      const accounts = data.accounts.filter((a) => a.enabled);
      let threadReadFailed = false;
      const entries = await Promise.all(
        accounts.map(async (a) => {
          const threadsRes = await fetch(
            `/api/email/threads?accountId=${encodeURIComponent(a.id)}`
          ).catch(() => null);
          const parsed = threadsRes?.ok
            ? ((await threadsRes.json().catch(() => null)) as { threads?: EmailThreadLite[] } | null)
            : null;
          if (!parsed) {
            threadReadFailed = true;
            return [a.id, [] as EmailThreadLite[]] as const;
          }
          return [a.id, Array.isArray(parsed.threads) ? parsed.threads : []] as const;
        })
      );
      setEmailAccounts(accounts);
      setThreadsByAccount(Object.fromEntries(entries));
      setMailFailed(threadReadFailed);
    } catch {
      setMailFailed(true);
    }
  }, []);

  useEffect(() => {
    void reloadChats();
  }, [reloadChats]);

  /**
   * Los hilos del buzón también son destino de cotización. Se listan por
   * cuenta activa; si el negocio no tiene correo configurado (o el que mira
   * no es owner y /api/email/accounts le responde 403) simplemente no
   * aparecen opciones de correo.
   */
  useEffect(() => {
    void reloadMail();
  }, [reloadMail]);

  /** Sólo chats de canales que pueden enviar cotización, agrupados por canal. */
  const chatsByChannel = useMemo(() => {
    const map = new Map<SendChannel, ConversationDto[]>();
    for (const channel of SEND_CHANNELS) {
      const list = conversations.filter((c) => c.channel === channel);
      if (list.length) map.set(channel, list);
    }
    return map;
  }, [conversations]);

  /** Un renglón por hilo de correo: se responde al mensaje más reciente. */
  const mailOptions = useMemo<MailOption[]>(
    () =>
      emailAccounts.flatMap((account) =>
        (threadsByAccount[account.id] ?? []).flatMap((thread) => {
          const latest = thread.messages[thread.messages.length - 1];
          if (!latest) return [];
          return [
            {
              value: mailValue(account.id, latest.id),
              accountId: account.id,
              accountEmail: account.email,
              accountLabel: account.label || account.email,
              messageId: latest.id,
              participantName: thread.participant.name || thread.participant.email,
              subject: thread.subject,
            },
          ];
        })
      ),
    [emailAccounts, threadsByAccount]
  );

  // El aviso de lectura fallida solo pinta cuando no hay ningún destino en
  // pantalla Y alguna de las dos lecturas cayó: si ambas respondieron bien y
  // simplemente no hay a dónde enviar, eso es un vacío real, no un error.
  const noSendTargets = chatsByChannel.size === 0 && mailOptions.length === 0;
  const sendTargetsError = !noSendTargets
    ? null
    : chatsFailed && mailFailed
      ? "No se pudieron leer los chats ni los hilos de correo; reintenta antes de asumir que no hay destinos."
      : chatsFailed
        ? "No se pudo leer la lista de chats; reintenta antes de asumir que no hay destinos."
        : mailFailed
          ? "No se pudieron leer los hilos de correo; reintenta antes de asumir que no hay destinos."
          : null;

  /** Destino elegido, validado contra los chats e hilos realmente disponibles. */
  const choice = useMemo(
    () => parseChoice(chatId, conversations, mailOptions),
    [chatId, conversations, mailOptions]
  );

  /** Chat del destino, para avisos de ventana de respuesta. */
  const selectedChat = useMemo(
    () => (choice?.kind === "chat" ? conversations.find((c) => c.id === choice.conversationId) ?? null : null),
    [choice, conversations]
  );

  useEffect(() => {
    // Al cargar la cotización, preselecciona el chat de su contacto.
    if (!quote?.contactId || chatId) return;
    const match = conversations.find((c) => c.contact.id === quote.contactId);
    if (match && SEND_CHANNELS.includes(match.channel as SendChannel)) setChatId(match.id);
  }, [quote?.contactId, conversations, chatId]);

  /**
   * Sin timeout ni rama de error, una petición que no volvía dejaba la ficha en
   * «Cargando…» para siempre: la vista no tiene otro estado que `!quote`.
   */
  const loadQuote = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/quotes/${quoteId}`, {
          signal: signal ?? AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(String(res.status));
        const d = (await res.json()) as { quote?: QuoteData };
        if (!d.quote) throw new Error("respuesta sin cotización");
        setQuote(d.quote);
        setDisplayName(getStoredName(quoteId, d.quote.quoteNumber));
        setLoadFailed(false);
      } catch {
        if (signal?.aborted) return;
        setLoadFailed(true);
      }
    },
    [quoteId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadQuote(controller.signal);
    return () => controller.abort();
  }, [loadQuote, revision]);

  const saveDisplayName = () => {
    const trimmed = displayName.trim();
    if (trimmed) {
      localStorage.setItem(`quote_name_${quoteId}`, trimmed);
    } else {
      localStorage.removeItem(`quote_name_${quoteId}`);
      if (quote) setDisplayName(quote.quoteNumber);
    }
    setEditingName(false);
  };

  const updateStatus = useCallback(
    async (newStatus: "accepted" | "rejected") => {
      setStatusBusy(true);
      setError("");
      const res = await fetch(`/api/quotes/${quoteId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      }).catch(() => null);
      setStatusBusy(false);
      if (!res?.ok) {
        setError((await res?.json())?.error?.message ?? "No se pudo actualizar el estado");
        return;
      }
      setRevision((r) => r + 1);
      onUpdated();
    },
    [quoteId, onUpdated]
  );

  /** Envía al destino elegido: el canal lo dicta la selección, no el botón. */
  const sendToSelected = useCallback(async () => {
    if (!choice) return;
    setSending(choice.kind);
    setError("");
    const response = await fetch(`/api/quotes/${quoteId}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Correo: se manda el hilo (cuenta + mensaje), nunca una dirección
      // tecleada; el servidor saca el destinatario de sus propios registros.
      body: JSON.stringify(
        choice.kind === "chat"
          ? { channel: choice.channel, conversationId: choice.conversationId }
          : {
              channel: "email",
              emailAccountId: choice.emailAccountId,
              emailMessageId: choice.emailMessageId,
            }
      ),
    }).catch(() => null);
    setSending(null);
    if (!response?.ok) { setError((await response?.json())?.error?.message ?? "No se pudo enviar"); return; }
    const res = await fetch(`/api/quotes/${quoteId}`).catch(() => null);
    if (res?.ok) {
      const d = (await res.json()) as { quote: QuoteData };
      setQuote(d.quote);
    }
    onUpdated();
  }, [choice, quoteId, onUpdated]);

  if (!quote && loadFailed) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-sm text-text-2">No se pudo cargar la cotización.</p>
          <Button variant="outline" onClick={() => void loadQuote()}>
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!quote) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">Cargando…</CardContent>
      </Card>
    );
  }

  const discount = quote.discountAmount;
  const pdfFilename = `${displayName || quote.quoteNumber}.pdf`;
  // El PDF imprime `clientPhone ?? teléfono del contacto`; la pantalla tenía que
  // decir lo mismo o una cotización vieja se veía sin número aquí y con número
  // en el archivo.
  const shownPhone = quote.clientPhone ?? quote.contactPhone;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-3">
          {/* Nombre editable */}
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onBlur={saveDisplayName}
                onKeyDown={(e) => { if (e.key === "Enter") saveDisplayName(); if (e.key === "Escape") { setDisplayName(getStoredName(quoteId, quote.quoteNumber)); setEditingName(false); } }}
                className="border-b border-primary bg-transparent text-lg font-bold outline-none"
                placeholder={quote.quoteNumber}
              />
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={saveDisplayName}>
                <CheckCircle className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <CardTitle className="flex items-center gap-2">
              {displayName}
              <button onClick={() => setEditingName(true)} className="text-muted-foreground hover:text-foreground" title="Editar nombre">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </CardTitle>
          )}
          <Badge variant={STATUS_VARIANT[quote.status] ?? "secondary"}>
            {STATUS_LABELS[quote.status] ?? quote.status}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar">
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {error && <p role="alert" className="text-destructive">{error}</p>}

        {/* Botones de acción */}
        <div className="mb-4 flex flex-wrap gap-2">
          <PdfActions url={`/api/quotes/${quoteId}/pdf`} filename={pdfFilename} />
          {quote.status === "draft" && <Button onClick={() => setEditing(true)}>Editar cotización</Button>}
          {(quote.status === "sent" || quote.status === "draft") && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={statusBusy}
                className="border-emerald-500 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                onClick={() => void updateStatus("accepted")}
              >
                <CheckCircle className="mr-1 h-3.5 w-3.5" /> Aprobar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={statusBusy}
                className="border-red-500 text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={() => void updateStatus("rejected")}
              >
                <XCircle className="mr-1 h-3.5 w-3.5" /> Rechazar
              </Button>
            </>
          )}
        </div>

        {editing && <NewQuoteDialog initial={quote} onClose={() => setEditing(false)} onCreated={() => { setEditing(false); setRevision((r) => r + 1); onUpdated(); }} />}
        {quote.message && <p className="mb-3 whitespace-pre-wrap text-sm">{quote.message}</p>}
        <div className="mb-3 text-sm text-muted-foreground">
          {quote.contactName ?? "Sin contacto"}
          {shownPhone ? ` · ${shownPhone}` : ""} · {formatDate(quote.createdAt)}
        </div>

        <div className="mb-4 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <caption className="sr-only">Artículos de la cotización</caption>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-1 font-medium">Artículo</th>
              <th className="pb-1 text-right font-medium">Cant.</th>
              <th className="pb-1 text-right font-medium">P. Unitario</th>
              <th className="pb-1 text-right font-medium">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((it, i) => (
              <tr key={i} className="border-b border-dashed">
                <td className="py-2">{it.name}</td>
                <td className="py-2 text-right">{it.quantity}</td>
                <td className="py-2 text-right">{formatMXNCents(it.unitPrice)}</td>
                <td className="py-2 text-right">{formatMXNCents(it.quantity * it.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatMXNCents(quote.subtotal)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-destructive">
              <span>Descuento</span>
              <span>-{formatMXNCents(discount)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">IVA ({quote.taxRate}%)</span>
            <span>{formatMXNCents(quote.taxAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-border-strong pt-1 font-semibold">
            <span>Total</span>
            <span>{formatMXNCents(quote.total)}</span>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Válida hasta el {quote.validUntil ? formatDate(quote.validUntil) : "sin fecha"}
        </p>

        {quote.status === "draft" && (
          <div className="mt-4 space-y-2">
            <label className="text-sm font-medium" htmlFor="quote-chat">
              Enviar a
            </label>
            {noSendTargets && sendTargetsError ? (
              <p className="text-xs text-destructive">
                {sendTargetsError}{" "}
                <button
                  type="button"
                  className="font-medium underline"
                  onClick={() => {
                    void reloadChats();
                    void reloadMail();
                  }}
                >
                  Reintentar
                </button>
              </p>
            ) : noSendTargets ? (
              <p className="text-sm text-muted-foreground">
                No hay chats conectados ni hilos de correo a los que enviar esta cotización.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  id="quote-chat"
                  className="h-9 max-w-full flex-1 rounded-md border border-input bg-background px-2 text-sm"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                >
                  <option value="">— Elige un chat o un hilo de correo —</option>
                  {[...chatsByChannel.entries()].map(([channel, list]) => (
                    <optgroup key={channel} label={CHANNEL_LABEL[channel]}>
                      {list.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.contact.name}
                          {c.contact.phone ? ` · ${c.contact.phone}` : ""}
                          {c.humanAgentMode
                            ? " · respuesta con agente humano (hasta 7 días)"
                            : c.channel === "google_business" || c.channel === "comments"
                              ? " · respuesta pública"
                              : c.windowOpen
                                ? ` · ventana abierta (${formatRemaining(c.windowRemainingMs)})`
                                : " · ventana cerrada"}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  {emailAccounts.map((account) => {
                    const opts = mailOptions.filter((m) => m.accountId === account.id);
                    if (!opts.length) return null;
                    return (
                      <optgroup key={account.id} label={`Correo · ${account.label || account.email}`}>
                        {opts.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.participantName} · {m.subject}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!choice || sending !== null}
                  onClick={() => void sendToSelected()}
                >
                  {sending
                    ? "Enviando…"
                    : choice?.kind === "chat"
                      ? `Enviar por ${CHANNEL_LABEL[choice.channel]}`
                      : choice?.kind === "email"
                        ? "Enviar por Correo"
                        : "Enviar cotización"}
                </Button>
              </div>
            )}
            {selectedChat && !selectedChat.windowOpen && selectedChat.channel !== "whatsapp" && (
              <p className="text-xs text-amber-600">
                {selectedChat.channel === "tiktok"
                  ? "Pasaron 48 horas desde el último mensaje. TikTok requiere que el cliente vuelva a escribir para abrir otra ventana de respuesta."
                  : `Pasaron 7 días desde el último mensaje. ${CHANNEL_LABEL[selectedChat.channel as Channel]} ya no admite la respuesta con etiqueta de agente humano; pide al cliente que vuelva a escribir.`}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
