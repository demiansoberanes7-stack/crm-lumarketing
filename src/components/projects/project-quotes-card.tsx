"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_LABELS, STATUS_VARIANT, formatMXNCents } from "@/components/quotes/shared";
import { taskRequest } from "@/components/tasks/api";

/**
 * Cotizaciones anidadas en un proyecto que ya existe.
 *
 * El vínculo cotización → proyecto solo se podía hacer al CREAR el proyecto; si
 * la cotización llegaba después (una ampliación, una segunda etapa) no había
 * dónde anidarla y el expediente quedaba sin su respaldo comercial. Aquí se
 * anida y se desanida sin tocar los importes de ninguno de los dos lados.
 */

type NestedQuote = {
  quoteId: string;
  quoteNumber: string;
  status: string;
  total: number;
  currency: string;
  contactName: string | null;
  linkedAt: string;
};

type Candidate = {
  id: string;
  quoteNumber: string;
  status: string;
  total: number;
  currency: string;
  contactName: string | null;
};

export function ProjectQuotesCard({ projectId }: { projectId: string }) {
  const [quotes, setQuotes] = useState<NestedQuote[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await taskRequest<{ quotes: NestedQuote[] }>(
        `/api/projects/${projectId}/quotes`
      );
      setQuotes(res.quotes);
    } catch {
      // Sin vínculo no hay sección: el proyecto sigue legible.
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  async function openPicker() {
    setPicking(true); setError("");
    try {
      const res = await taskRequest<{ quotes: Candidate[] }>("/api/quotes?forProject=1&limit=100");
      setCandidates(res.quotes);
      setPicked(res.quotes[0]?.id ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron listar las cotizaciones");
    }
  }

  async function link() {
    if (!picked) return;
    setBusy(true); setError("");
    try {
      await taskRequest(`/api/projects/${projectId}/quotes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId: picked }),
      });
      setPicking(false);
      setPicked("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anidar la cotización");
    } finally {
      setBusy(false);
    }
  }

  async function unlink(quoteId: string) {
    setBusy(true); setError("");
    try {
      await taskRequest(`/api/projects/${projectId}/quotes/${quoteId}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo desanidar la cotización");
    } finally {
      setBusy(false);
    }
  }

  const total = quotes.reduce((sum, q) => sum + q.total, 0);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-sm">Cotizaciones anidadas</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Una cotización pertenece a un solo proyecto; anidar no duplica ni modifica importes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!!quotes.length && <span className="text-sm font-semibold">{formatMXNCents(total)}</span>}
          {!picking && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void openPicker()}>
              <Link2 className="mr-1.5 h-4 w-4" /> Anidar cotización
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {quotes.length ? (
          <ul className="space-y-2">
            {quotes.map((q) => (
              <li key={q.quoteId} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {q.quoteNumber}
                    {q.contactName ? <span className="text-muted-foreground"> — {q.contactName}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Anidada {new Date(q.linkedAt).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[q.status] ?? "secondary"}>
                  {STATUS_LABELS[q.status] ?? q.status}
                </Badge>
                <span className="font-semibold">{formatMXNCents(q.total)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Desanidar ${q.quoteNumber}`}
                  disabled={busy}
                  onClick={() => void unlink(q.quoteId)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Sin cotizaciones anidadas</p>
        )}

        {picking && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
            <div className="min-w-0 flex-1">
              <label className="text-xs text-muted-foreground" htmlFor="quote-picker">
                Cotización disponible (sin proyecto)
              </label>
              <select
                id="quote-picker"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
              >
                {candidates.length === 0 && <option value="">No hay cotizaciones libres</option>}
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.quoteNumber}
                    {c.contactName ? ` — ${c.contactName}` : ""} · {formatMXNCents(c.total)}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="outline" size="sm" disabled={busy || !picked} onClick={() => void link()}>
              Anidar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => { setPicking(false); setError(""); }}
            >
              Cancelar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
