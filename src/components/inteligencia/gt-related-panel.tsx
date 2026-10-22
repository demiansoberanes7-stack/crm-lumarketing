"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Copy,
  Download,
  Plus,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Search,
} from "lucide-react";
import { downloadCsv, copyList } from "@/components/inteligencia/intel-export";

/**
 * Panel «Temas relacionados / Consultas relacionadas», las dos columnas que
 * Google Trends pone una junto a la otra.
 *
 * Cada columna tiene sus dos listas (Principal = índice 0–100, Subiendo = % de
 * alza o «Aumento puntual»), orden ascendente/descendente, paginación de 5 en 5
 * y pie con el total real. El botón «+» de cada fila convierte ese tema o
 * consulta en nicho monitoreado: es el punto donde la lectura se vuelve dato
 * propio del CRM.
 */

export type RelatedItem = {
  label: string;
  value: number;
  pct: number | null;
  isBreakout: boolean;
  list: "top" | "rising";
};

type Props = {
  topics: RelatedItem[];
  queries: RelatedItem[];
  termName: string;
  onMonitor: (keyword: string) => Promise<string | null>;
  /** Relación del nicho mostrado con la búsqueda activa (null sin búsqueda). */
  note?: string | null;
};

const PAGE_SIZE = 5;

const LIST_LABEL = { top: "Principal", rising: "Subiendo" } as const;

function metricOf(item: RelatedItem): number {
  return item.list === "rising" ? (item.pct ?? Number.MAX_SAFE_INTEGER) : item.value;
}

function Metric({ item }: { item: RelatedItem }) {
  if (item.isBreakout) {
    return (
      <span className="shrink-0 rounded bg-success-tint px-1.5 py-0.5 text-[10px] font-medium text-success-text">
        Aumento puntual
      </span>
    );
  }
  if (item.list === "rising") {
    return (
      <span className="shrink-0 font-medium tabular-nums text-success-text">
        {item.pct === null ? "—" : `+${item.pct}%`}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-subtle">
        <span
          className="block h-full rounded-full bg-brand-text"
          style={{ width: `${Math.max(2, Math.min(100, item.value))}%` }}
        />
      </span>
      <span className="w-6 text-right font-medium tabular-nums text-text-2">{item.value}</span>
    </span>
  );
}

function RelatedColumn({
  icon,
  title,
  items,
  slug,
  onMonitor,
}: {
  icon: "topic" | "query";
  title: string;
  items: RelatedItem[];
  slug: string;
  onMonitor: (keyword: string) => Promise<string | null>;
}) {
  const [list, setList] = useState<"top" | "rising">("top");
  const [desc, setDesc] = useState(true);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  const rows = useMemo(() => {
    const filtered = items.filter((i) => i.list === list);
    return [...filtered].sort((a, b) => (desc ? metricOf(b) - metricOf(a) : metricOf(a) - metricOf(b)));
  }, [items, list, desc]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const slice = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const counts = {
    top: items.filter((i) => i.list === "top").length,
    rising: items.filter((i) => i.list === "rising").length,
  };

  async function monitor(label: string) {
    setBusy(label);
    setFeedback("");
    const message = await onMonitor(label).catch(() => "No se pudo monitorear.");
    setFeedback(message ?? "");
    setBusy(null);
  }

  const Icon = icon === "topic" ? Sparkles : Search;
  const noun = icon === "topic" ? "temas" : "consultas";

  return (
    <section className="min-w-0 flex-1 rounded-xl border bg-card p-4 shadow-sm" aria-label={title}>
      <header className="flex items-start justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon className="h-4 w-4 text-brand-text" /> {title}
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={`Exportar ${noun} a CSV`}
            aria-label={`Exportar ${noun} a CSV`}
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                `${slug}-${list}.csv`,
                ["titulo", "lista", "indice_o_alza_pct", "aumento_puntual"],
                rows.map((r) => [
                  r.label,
                  LIST_LABEL[r.list],
                  r.list === "rising" ? (r.pct ?? "") : r.value,
                  r.isBreakout ? "sí" : "",
                ])
              )
            }
            className="rounded p-1 text-text-3 hover:bg-subtle hover:text-foreground disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={`Copiar ${noun}`}
            aria-label={`Copiar ${noun}`}
            disabled={rows.length === 0}
            onClick={() =>
              void copyList(rows.map((r) => r.label)).then((ok) =>
                setFeedback(ok ? "Lista copiada." : "El navegador bloqueó el portapapeles.")
              )
            }
            className="rounded p-1 text-text-3 hover:bg-subtle hover:text-foreground disabled:opacity-40"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={desc ? "Orden: mayor a menor" : "Orden: menor a mayor"}
            aria-label={desc ? "Cambiar orden a menor a mayor" : "Cambiar orden a mayor a menor"}
            onClick={() => setDesc((d) => !d)}
            className="rounded p-1 text-text-3 hover:bg-subtle hover:text-foreground"
          >
            {desc ? <ArrowDownWideNarrow className="h-3.5 w-3.5" /> : <ArrowUpWideNarrow className="h-3.5 w-3.5" />}
          </button>
        </div>
      </header>

      <div className="mt-2 flex gap-1 rounded-md bg-subtle p-0.5" role="group" aria-label={`Lista de ${noun}`}>
        {(["top", "rising"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={list === k}
            onClick={() => {
              setList(k);
              setPage(0);
            }}
            className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              list === k ? "bg-card shadow-xs text-foreground" : "text-text-2 hover:text-foreground"
            }`}
          >
            {LIST_LABEL[k]} ({counts[k]})
          </button>
        ))}
      </div>

      {slice.length === 0 ? (
        <p className="mt-3 rounded-md bg-subtle p-3 text-xs text-text-2">
          Sin {noun} en la lista «{LIST_LABEL[list]}» para esta ventana.
        </p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {slice.map((item) => (
            <li key={`${list}-${item.label}`} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate" title={item.label}>
                {item.label}
              </span>
              <Metric item={item} />
              <button
                type="button"
                title="Monitorear este término"
                aria-label={`Monitorear ${item.label}`}
                disabled={busy === item.label}
                onClick={() => void monitor(item.label)}
                className="shrink-0 rounded border border-border p-0.5 text-text-3 hover:border-brand-text hover:text-brand-text disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ol>
      )}

      {feedback && (
        <p role="status" className="mt-2 text-[11px] text-brand-text">
          {feedback}
        </p>
      )}

      <footer className="mt-3 flex items-center justify-between border-t pt-2 text-[11px] text-text-3">
        <span>
          Mostrando {rows.length === 0 ? 0 : safePage * PAGE_SIZE + 1}-
          {Math.min(rows.length, (safePage + 1) * PAGE_SIZE)} de {rows.length} {noun}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Página anterior"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded p-0.5 hover:bg-subtle disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="tabular-nums">
            {safePage + 1}/{pages}
          </span>
          <button
            type="button"
            aria-label="Página siguiente"
            disabled={safePage >= pages - 1}
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            className="rounded p-0.5 hover:bg-subtle disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </span>
      </footer>
    </section>
  );
}

export function GtRelatedPanel({ topics, queries, termName, onMonitor, note = null }: Props) {
  if (topics.length === 0 && queries.length === 0) return null;
  const slug = termName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "termino";

  return (
    <section className="space-y-2" aria-label="Temas y consultas relacionadas">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Temas y consultas relacionadas</h2>
        <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-text-2">
          Google Trends · {termName}
        </span>
      </div>
      {note && <p className="text-xs text-text-3">{note}</p>}
      <div className="flex flex-col gap-3 lg:flex-row">
        <RelatedColumn icon="topic" title="Temas relacionados" items={topics} slug={`${slug}-temas`} onMonitor={onMonitor} />
        <RelatedColumn icon="query" title="Consultas relacionadas" items={queries} slug={`${slug}-consultas`} onMonitor={onMonitor} />
      </div>
      <p className="text-[11px] leading-snug text-text-3">
        «Principal» es el índice 0–100 de la ventana; «Subiendo» es el % de crecimiento frente al
        periodo anterior, y «Aumento puntual» cuando Google no publica porcentaje porque el
        denominador es casi cero. El botón + convierte el tema o la consulta en un nicho propio y
        lo mete al ranking.
      </p>
    </section>
  );
}
