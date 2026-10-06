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
  const [sending, setSending] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [chatId, setChatId] = useState<string>("");

  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => (r.ok ? r.json() : { conversations: [] }))
      .then((d: { conversations?: ConversationDto[] }) =>
        setConversations(Array.isArray(d.conversations) ? d.conversations : [])
      )
      .catch(() => setConversations([]));
  }, []);

  /** Sólo chats de canales que pueden enviar cotización, agrupados por canal. */
  const chatsByChannel = useMemo(() => {
    const map = new Map<SendChannel, ConversationDto[]>();
    for (const channel of SEND_CHANNELS) {
      const list = conversations.filter((c) => c.channel === channel);
      if (list.length) map.set(channel, list);
    }
    return map;
  }, [conversations]);

  /** Chat elegido, validado contra el canal que se va a usar. */
  const selectedChat = useMemo(
    () => conversations.find((c) => c.id === chatId) ?? null,
    [conversations, chatId]
  );

  useEffect(() => {
    // Al cargar la cotización, preselecciona el chat de su contacto.
    if (!quote?.contactId || chatId) return;
    const match = conversations.find((c) => c.contact.id === quote.contactId);
    if (match) setChatId(match.id);
  }, [quote?.contactId, conversations, chatId]);

  useEffect(() => {
    fetch(`/api/quotes/${quoteId}`)
      .then((r) => r.json())
      .then((d: { quote: QuoteData }) => {
        setQuote(d.quote);
        setDisplayName(getStoredName(quoteId, d.quote.quoteNumber));
      })
      .catch(() => {});
  }, [quoteId, revision]);

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

  const sendVia = useCallback(
    async (channel: SendChannel) => {
      setSending(channel);
      setError("");
      const response = await fetch(`/api/quotes/${quoteId}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel,
          // Si el chat elegido es de este canal, se manda a ese; si no, la API
          // resuelve por el contacto de la cotización (comportamiento clásico).
          conversationId:
            selectedChat && selectedChat.channel === channel
              ? selectedChat.id
              : undefined,
        }),
      }).catch(() => null);
      setSending(null);
      if (!response?.ok) { setError((await response?.json())?.error?.message ?? "No se pudo enviar"); return; }
      const res = await fetch(`/api/quotes/${quoteId}`).catch(() => null);
      if (res?.ok) {
        const d = (await res.json()) as { quote: QuoteData };
        setQuote(d.quote);
      }
      onUpdated();
    },
    [quoteId, onUpdated, selectedChat]
  );

  /** Envía al chat seleccionado: el canal lo dicta el chat, no el botón. */
  const sendToSelected = useCallback(() => {
    if (selectedChat) void sendVia(selectedChat.channel as SendChannel);
  }, [sendVia, selectedChat]);

  if (!quote) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">Cargando…</CardContent>
      </Card>
    );
  }

  const discount = quote.discountAmount;
  const pdfFilename = `${displayName || quote.quoteNumber}.pdf`;

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
          {quote.contactName ?? "Sin contacto"} · {formatDate(quote.createdAt)}
        </div>

        <table className="mb-4 w-full text-sm">
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
            {chatsByChannel.size === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay chats en canales conectados para enviar esta cotización.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  id="quote-chat"
                  className="h-9 max-w-full flex-1 rounded-md border border-input bg-background px-2 text-sm"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                >
                  <option value="">— Elige un chat —</option>
                  {[...chatsByChannel.entries()].map(([channel, list]) => (
                    <optgroup key={channel} label={CHANNEL_LABEL[channel]}>
                      {list.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.contact.name}
                          {c.contact.phone ? ` · ${c.contact.phone}` : ""}
                          {c.windowOpen
                            ? ` · ventana abierta (${formatRemaining(c.windowRemainingMs)})`
                            : " · ventana cerrada"}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!selectedChat || sending !== null}
                  onClick={sendToSelected}
                >
                  {sending
                    ? "Enviando…"
                    : selectedChat
                      ? `Enviar por ${CHANNEL_LABEL[selectedChat.channel as Channel]}`
                      : "Enviar cotización"}
                </Button>
              </div>
            )}
            {selectedChat && !selectedChat.windowOpen && selectedChat.channel !== "whatsapp" && (
              <p className="text-xs text-amber-600">
                La ventana de 24 h de {CHANNEL_LABEL[selectedChat.channel as Channel]} está
                cerrada: Meta sólo acepta la etiqueta de agente humano, y puede rechazarla
                con el error #100. Pide al cliente que escriba primero.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
