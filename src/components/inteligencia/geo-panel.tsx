"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPinned, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Competencia por estado (DENUE) — mapa de rejilla de México con celdas
 * posicionadas de forma aproximada. Cada celda se colorea por intensidad de
 * conteo; "≥10" indica censura de la API (la ventana devolvió 10 y el total
 * real puede ser mayor). Unidad: establecimientos coincidentes (conteo DENUE).
 */

type GeoStateCell = {
  code: string;
  name: string;
  short: string;
  col: number;
  row: number;
  count: number;
  censored: boolean;
  sharePct: number;
};

type GeoReportView =
  | { available: false; reason: string }
  | {
      available: true;
      termId: string;
      termName: string;
      day: string;
      total: number;
      states: GeoStateCell[];
    };

type TermOption = { id: string; name: string };

function cellLabel(s: GeoStateCell): string {
  return s.censored ? `≥${s.count}` : String(s.count);
}

export function GeoPanel({ terms }: { terms: TermOption[] }) {
  const [termId, setTermId] = useState<string>("");
  const [report, setReport] = useState<GeoReportView | null>(null);
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!termId && terms.length > 0) setTermId(terms[0]!.id);
  }, [terms, termId]);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError("");
    const res = await fetch(`/api/intel/geo?termId=${encodeURIComponent(id)}`, {
      cache: "no-store",
    }).catch(() => null);
    setLoading(false);
    if (res?.ok) {
      const data = (await res.json().catch(() => null)) as GeoReportView | null;
      setReport(data);
    } else {
      setReport(null);
    }
  }, []);

  useEffect(() => { void load(termId); }, [termId, load]);

  async function handleIngest() {
    if (!termId) return;
    setIngesting(true);
    setError("");
    const res = await fetch("/api/intel/geo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ termId }),
    }).catch(() => null);
    setIngesting(false);
    if (res?.ok) {
      await load(termId);
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo calcular el mapa.");
    }
  }

  const max = useMemo(
    () => (report?.available ? Math.max(...report.states.map((s) => s.count), 1) : 1),
    [report]
  );
  const top = useMemo(() => {
    if (!report?.available) return [];
    return [...report.states].sort((a, b) => b.count - a.count).slice(0, 5);
  }, [report]);

  if (terms.length === 0) return null;

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Competencia por estado">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <MapPinned className="h-4 w-4 text-brand-text" /> Competencia por estado
          <span className="text-sm font-normal text-text-2">(DENUE · INEGI)</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={termId}
            onChange={(e) => setTermId(e.target.value)}
            aria-label="Nicho para el mapa"
            className="min-h-9 rounded-md border bg-background px-2 text-sm"
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <Button variant="outline" onClick={() => void handleIngest()} disabled={ingesting || !termId}>
            <RefreshCw className={`mr-2 h-4 w-4 ${ingesting ? "animate-spin" : ""}`} />
            {ingesting ? "Consultando 32 estados…" : "Calcular mapa"}
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">
          {error}
        </p>
      )}

      {report && !report.available && report.reason === "missing_denue_token" && (
        <p className="mt-3 rounded-md bg-subtle p-3 text-sm text-text-2">
          Falta el token DENUE. Configúralo en Conexiones → Inteligencia para habilitar el
          mapa de competencia por estado.
        </p>
      )}

      {report && !report.available && report.reason === "no_data" && (
        <p className="mt-3 rounded-md bg-subtle p-3 text-sm text-text-2">
          Aún no hay datos geográficos para este nicho. Pulsa «Calcular mapa» (hace 32
          consultas al directorio público DENUE, tarda ~15 s).
        </p>
      )}

      {loading && !report && (
        <p className="mt-3 rounded-md bg-subtle p-3 text-sm text-text-2">Cargando mapa…</p>
      )}

      {report?.available && (
        <>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_220px]">
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: "repeat(9, minmax(0, 1fr))" }}
              role="img"
              aria-label={`Mapa de competencia: ${report.termName}, ${report.day}`}
            >
              {report.states.map((s) => {
                const alpha = 0.1 + 0.9 * (s.count / max);
                const dark = alpha > 0.55;
                return (
                  <div
                    key={s.code}
                    title={`${s.name}: ${cellLabel(s)} establecimientos (${s.sharePct.toFixed(1)}% del conteo)`}
                    className="flex min-h-[44px] flex-col items-center justify-center rounded-[4px] border border-border/40 px-0.5"
                    style={{
                      gridColumn: s.col + 1,
                      gridRow: s.row + 1,
                      background: `rgba(76, 110, 245, ${alpha.toFixed(3)})`,
                      color: dark ? "#fff" : "var(--color-text-2, #344054)",
                    }}
                  >
                    <span className="text-[9px] font-semibold leading-tight sm:text-[10px]">{s.short}</span>
                    <span className="text-[9px] tabular-nums leading-tight sm:text-[10px]">{cellLabel(s)}</span>
                  </div>
                );
              })}
            </div>
            <div>
              <h3 className="text-xs font-semibold text-text-2">Top estados</h3>
              <ol className="mt-2 space-y-1.5">
                {top.map((s) => (
                  <li key={s.code} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate">{s.name}</span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {cellLabel(s)} · {s.sharePct.toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[11px] leading-snug text-text-3">
                Día {report.day} · {report.total} coincidencias en 32 estados
                {top.some((s) => s.censored) ? " (≥ = censura de la API)" : ""}.
              </p>
            </div>
          </div>
          <p className="mt-4 border-t pt-3 text-[11px] leading-snug text-text-3">
            Unidad: establecimientos públicos DENUE que coinciden con el término del nicho
            (conteo por ventana de 10; «≥10» = censurado). Las posiciones de los estados en
            la rejilla son aproximadas. Es un proxy de oferta/competencia local, NO de
            demanda. Fuente: DENUE · INEGI (directorio nacional de unidades económicas).
          </p>
        </>
      )}
    </section>
  );
}
