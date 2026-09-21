"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Plus, Package, Archive, Trash2, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NewQuoteDialog } from "./new-quote-dialog";
import { QuoteDetail } from "./quote-detail";
import { QuoteItem, STATUS_LABELS, STATUS_VARIANT, formatMXNCents, formatDate } from "./shared";

interface Quote {
  id: string;
  quoteNumber: string;
  contactId: string | null;
  contactName: string | null;
  status: string;
  total: number;
  currency: string;
  items: QuoteItem[];
  discountType: string | null;
  discountValue: string | null;
  taxRate: number;
  validDays: number;
  notes: string | null;
  createdAt: string;
  archivedAt: string | null;
}

type Tab = "active" | "archived";

export function QuotesClient() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [showNewQuote, setShowNewQuote] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("active");

  const refetch = useCallback(async () => {
    const archived = activeTab === "archived" ? "&archived=1" : "";
    const res = await fetch(`/api/quotes?${archived}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { quotes: Quote[] };
    setQuotes(data.quotes);
  }, [activeTab]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function archiveQuote(id: string) {
    await fetch(`/api/quotes/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    }).catch(() => null);
    void refetch();
  }

  async function unarchiveQuote(id: string) {
    await fetch(`/api/quotes/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "unarchive" }),
    }).catch(() => null);
    void refetch();
  }

  async function deleteQuote(id: string) {
    if (!confirm("¿Eliminar esta cotización permanentemente?")) return;
    await fetch(`/api/quotes/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete" }),
    }).catch(() => null);
    void refetch();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-bold tracking-tight">Cotizador</h2>
          <Button size="sm" onClick={() => setShowNewQuote(true)}>
            <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Nueva Cotización
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowCatalog(true)}>
          <Package className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
          Catálogo
        </Button>
      </header>

      <div className="flex gap-1 border-b px-4 sm:px-6">
        <button
          onClick={() => setActiveTab("active")}
          className={`px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === "active"
              ? "border-b-2 border-brand text-brand"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Cotizaciones
        </button>
        <button
          onClick={() => setActiveTab("archived")}
          className={`px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === "archived"
              ? "border-b-2 border-brand text-brand"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Archive className="mr-1.5 inline h-4 w-4" />
          Archivados
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {quotes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium">Sin cotizaciones</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Crea una nueva cotización para enviar a tus clientes por WhatsApp,
              Instagram o Messenger.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {quotes.map((q) => (
              <li key={q.id}>
                {selectedQuoteId === q.id ? (
                  <QuoteDetail
                    quoteId={q.id}
                    onClose={() => setSelectedQuoteId(null)}
                    onUpdated={refetch}
                  />
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent">
                    <button
                      onClick={() => setSelectedQuoteId(q.id)}
                      className="flex min-w-0 flex-1 items-center gap-x-4 text-left"
                    >
                      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-[60%] flex-1 sm:min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{q.quoteNumber}</span>
                          <Badge variant={STATUS_VARIANT[q.status] ?? "secondary"}>
                            {STATUS_LABELS[q.status] ?? q.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {q.contactName ?? "Sin contacto"} · {formatDate(q.createdAt)}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold">{formatMXNCents(q.total)}</span>
                    </button>
                    <div className="flex shrink-0 gap-1">
                      {activeTab === "active" ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Archivar"
                          onClick={() => void archiveQuote(q.id)}
                        >
                          <Archive className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Restaurar"
                            onClick={() => void unarchiveQuote(q.id)}
                          >
                            <RotateCcw className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Eliminar"
                            onClick={() => void deleteQuote(q.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {showNewQuote && (
        <NewQuoteDialog
          onClose={() => setShowNewQuote(false)}
          onCreated={() => {
            setShowNewQuote(false);
            void refetch();
          }}
        />
      )}

      {showCatalog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
          onClick={() => setShowCatalog(false)}
        >
          <div
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <CatalogInline onClose={() => setShowCatalog(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

function CatalogInline({ onClose }: { onClose: () => void }) {
  const [products, setProducts] = useState<{ id: string; name: string; price: number }[]>([]);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newDesc, setNewDesc] = useState("");

  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((d: { products: { id: string; name: string; price: number }[] }) => setProducts(d.products))
      .catch(() => {});
  }, []);

  async function addProduct() {
    if (!newName.trim() || !newPrice) return;
    await fetch("/api/catalog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), price: Number(newPrice), description: newDesc || undefined }),
    }).catch(() => null);
    setNewName("");
    setNewPrice("");
    setNewDesc("");
    const res = await fetch("/api/catalog").catch(() => null);
    if (res?.ok) {
      const d = (await res.json()) as { products: { id: string; name: string; price: number }[] };
      setProducts(d.products);
    }
  }

  async function deleteProduct(id: string) {
    await fetch(`/api/catalog/${id}`, { method: "DELETE" }).catch(() => null);
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">Catálogo de Productos</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cerrar
        </Button>
      </div>

      <div className="space-y-2">
        {products.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <span className="text-sm font-medium">{p.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">{formatMXNCents(p.price)}</span>
            </div>
            <Button variant="ghost" size="icon" onClick={() => void deleteProduct(p.id)}>
              <span className="sr-only">Eliminar</span>
              ×
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        <input
          placeholder="Nombre del producto"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
        />
        <input
          placeholder="Precio (MXN)"
          type="number"
          value={newPrice}
          onChange={(e) => setNewPrice(e.target.value)}
          onBlur={(e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) {
              setNewPrice(val.toFixed(2));
            }
          }}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
        />
        <input
          placeholder="Descripción (opcional)"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
        />
        <Button onClick={() => void addProduct()} disabled={!newName.trim() || !newPrice}>
          Agregar producto
        </Button>
      </div>
    </div>
  );
}
