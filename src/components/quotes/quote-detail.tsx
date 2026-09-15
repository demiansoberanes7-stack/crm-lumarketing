"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Pencil, X, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PdfActions } from "@/components/pdf-actions";
import { NewQuoteDialog } from "./new-quote-dialog";
import { QuoteItem, STATUS_LABELS, STATUS_VARIANT, formatMXNCents, formatDate } from "./shared";

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
    async (channel: "whatsapp" | "instagram" | "messenger") => {
      setSending(channel);
      setError("");
      const response = await fetch(`/api/quotes/${quoteId}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
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
    [quoteId, onUpdated]
  );

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
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={sending === "whatsapp"}
              onClick={() => void sendVia("whatsapp")}
            >
              {sending === "whatsapp" ? "Enviando…" : "Enviar por WhatsApp"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={sending === "instagram"}
              onClick={() => void sendVia("instagram")}
            >
              {sending === "instagram" ? "Enviando…" : "Enviar por Instagram"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={sending === "messenger"}
              onClick={() => void sendVia("messenger")}
            >
              {sending === "messenger" ? "Enviando…" : "Enviar por Messenger"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
