"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface QuoteItem {
  name: string;
  quantity: number;
  unitPrice: number;
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
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviada",
  accepted: "Aceptada",
  rejected: "Rechazada",
};

const STATUS_VARIANT: Record<string, "secondary" | "outline" | "success" | "destructive"> = {
  draft: "secondary",
  sent: "outline",
  accepted: "success",
  rejected: "destructive",
};

function formatMXN(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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

  useEffect(() => {
    fetch(`/api/quotes/${quoteId}`)
      .then((r) => r.json())
      .then((d: { quote: QuoteData }) => setQuote(d.quote))
      .catch(() => {});
  }, [quoteId]);

  const sendVia = useCallback(
    async (channel: "whatsapp" | "instagram" | "messenger") => {
      setSending(channel);
      await fetch(`/api/quotes/${quoteId}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel }),
      }).catch(() => null);
      setSending(null);
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

  const discount =
    quote.discountType === "fixed"
      ? quote.discountValue ?? 0
      : quote.discountType === "percentage"
        ? (quote.subtotal * (quote.discountValue ?? 0)) / 100
        : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-3">
          <CardTitle>{quote.quoteNumber}</CardTitle>
          <Badge variant={STATUS_VARIANT[quote.status] ?? "secondary"}>
            {STATUS_LABELS[quote.status] ?? quote.status}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="mb-3 text-sm text-muted-foreground">
          {quote.contactName ?? "Sin contacto"} · {formatDate(quote.createdAt)}
        </div>

        <table className="mb-4 w-full text-sm">
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
                <td className="py-2 text-right">{formatMXN(it.unitPrice)}</td>
                <td className="py-2 text-right">{formatMXN(it.quantity * it.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatMXN(quote.subtotal)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-destructive">
              <span>Descuento</span>
              <span>-{formatMXN(discount)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">IVA ({quote.taxRate}%)</span>
            <span>{formatMXN(quote.taxAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-border-strong pt-1 font-semibold">
            <span>Total</span>
            <span>{formatMXN(quote.total)}</span>
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
