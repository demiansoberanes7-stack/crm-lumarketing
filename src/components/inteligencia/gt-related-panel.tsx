"use client";

import { useState } from "react";
import { Sparkles, Search } from "lucide-react";

/**
 * Panel «Temas y consultas» estilo Google Trends: dos listas (temas = topics,
 * consultas = queries) con el índice 0–100 y, para rising, el % de crecimiento
 * o la etiqueta «Aumento puntual» si Google lo marcó breakout (sin %: el
 * denominador ~0 no produce un % significativo).
 */

type RelatedItem = {
  label: string;
  value: number;
  pct: number | null;
  isBreakout: boolean;
};

type Props = {
  topics: RelatedItem[];
  queries: RelatedItem[];
};

function RelatedRow({ item }: { item: RelatedItem }) {
  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      <span className="min-w-0 truncate">{item.label}</span>
      {item.isBreakout ? (
        <span className="shrink-0 rounded bg-success-tint px-1.5 py-0.5 text-[10px] font-medium text-success-text">
          Aumento puntual
        </span>
      ) : item.pct !== null ? (
        <span className="shrink-0 font-medium tabular-nums text-success-text">
          +{item.pct}%
        </span>
      ) : (
        <span className="shrink-0 font-medium tabular-nums text-text-2">{item.value}</span>
      )}
    </li>
  );
}

export function GtRelatedPanel({ topics, queries }: Props) {
  const [tab, setTab] = useState<"queries" | "topics">("queries");

  const isEmpty = topics.length === 0 && queries.length === 0;
  if (isEmpty) return null;

  const items = tab === "queries" ? queries : topics;

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Temas y consultas">
      <h2 className="font-semibold">Temas y consultas relacionadas</h2>
      <div className="mt-2 flex gap-1 rounded-md bg-subtle p-0.5">
        <button
          type="button"
          onClick={() => setTab("queries")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${
            tab === "queries" ? "bg-card shadow-xs" : "text-text-2 hover:text-foreground"
          }`}
        >
          <Search className="h-3 w-3" /> Consultas ({queries.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("topics")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${
            tab === "topics" ? "bg-card shadow-xs" : "text-text-2 hover:text-foreground"
          }`}
        >
          <Sparkles className="h-3 w-3" /> Temas ({topics.length})
        </button>
      </div>

      {items.length === 0 ? (
        <p className="mt-3 rounded-md bg-subtle p-3 text-sm text-text-2">
          Sin {tab === "queries" ? "consultas" : "temas"} relacionados para esta ventana.
        </p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {items.map((item) => (
            <RelatedRow key={`${tab}-${item.label}`} item={item} />
          ))}
        </ol>
      )}

      <p className="mt-4 border-t pt-3 text-[11px] leading-snug text-text-3">
        Unidad: índice 0–100 para top; % de crecimiento o «Aumento puntual» para rising.
        Fuente: Google Trends (endpoint no oficial).
      </p>
    </section>
  );
}
