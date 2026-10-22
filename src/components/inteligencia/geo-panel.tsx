"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPinned, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pollIntelJob } from "@/lib/intel-jobs-client";
import { relationIndex, relationLabel, type CatalogMatch } from "@/lib/intel-relation";

/**
 * Competencia por estado (DENUE) — mapa de rejilla de México con celdas
 * posicionadas de forma aproximada. Cada celda se colorea por intensidad de
 * conteo; "≥10" indica censura de la API (la ventana devolvió 10 y el total
 * real puede ser mayor); "sin dato" indica un estado que no respondió — NO es
 * cero competidores. Unidad: establecimientos coincidentes (conteo DENUE).
 */

type GeoStateCell = {
  code: string;
  name: string;
  short: string;
  col: number;
  row: number;
  count: number;
  censored: boolean;
  status: "ok" | "censored" | "missing";
  /** null ⇒ proporción no confiable (censura o estados faltantes). */
  sharePct: number | null;
};

type GeoReportView =
  | { available: false; reason: string }
  | {
      available: true;
      termId: string;
      termName: string;
      day: string;
      /** Límite inferior salvo `totalExact`. */
      totalLowerBound: number;
      totalExact: boolean;
      missingStates: number;
      censoredStates: number;
      states: GeoStateCell[];
    };

type TermOption = { id: string; name: string };

function cellLabel(s: GeoStateCell): string {
  if (s.status === "missing") return "sin dato";
  return s.censored ? `≥${s.count}` : String(s.count);
}

function shareLabel(s: GeoStateCell): string {
  return s.sharePct === null ? "" : ` · ${s.sharePct.toFixed(0)}%`;
}

export function GeoPanel({
  terms,
  relatedTermId = null,
  matches = null,
  competition = null,
  queryLabel = null,
}: {
  terms: TermOption[];
  /**
   * Nicho del catálogo que ES la búsqueda activa: el mapa arranca en él en vez
   * de ocultarse. Un vecino solo parecido no llega aquí — el DENUE responde por
   * término ya monitoreado (32 consultas), y mover el mapa por una coincidencia
   * vaga diría «esto es lo que buscaste» cuando no lo es.
   */
  relatedTermId?: string | null;
  /** Relación de cada nicho del catálogo con la consulta (incluye «sin palabras en común»). */
  matches?: CatalogMatch[] | null;
  /**
   * Oferta nacional DENUE de la CONSULTA (una sola llamada, ya hecha por el
   * análisis). El desglose por estado solo existe por nicho; este conteo es lo
   * que permite hablar de la búsqueda dentro de este panel sin gastar 32 llamadas.
   */
  competition?: { establishments: number; censored: boolean } | null;
  queryLabel?: string | null;
}) {
  // Arranca en el nicho de la búsqueda si está en la lista (puede no tener serie
  // GT todavía), o en el primero: así la nota nunca nombra un nicho vacío.
  const [termId, setTermId] = useState<string>(() => {
    const preferred =
      relatedTermId && terms.some((t) => t.id === relatedTermId) ? relatedTermId : terms[0]?.id;
    return preferred ?? "";
  });
  const [report, setReport] = useState<GeoReportView | null>(null);
  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const matchById = useMemo(() => relationIndex(matches ?? []), [matches]);
  const activeMatch = matchById.get(termId) ?? null;
  const activeName =
    terms.find((t) => t.id === termId)?.name ??
    (report?.available ? report.termName : "este nicho");

  useEffect(() => {
    if (!termId && terms.length > 0) setTermId(terms[0]!.id);
  }, [terms, termId]);

  useEffect(() => {
    if (!relatedTermId) return;
    if (terms.some((t) => t.id === relatedTermId)) setTermId(relatedTermId);
  }, [relatedTermId, terms]);

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
    setProgress("");
    const res = await fetch("/api/intel/geo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ termId }),
    }).catch(() => null);
    if (!res?.ok) {
      setIngesting(false);
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo calcular el mapa.");
      return;
    }
    const data = await res.json().catch(() => null) as { job?: { id?: string } } | null;
    const jobId = data?.job?.id;
    if (!jobId) {
      setIngesting(false);
      return;
    }
    // Las 32 consultas corren fuera de la petición: se sigue el avance n/32.
    const job = await pollIntelJob(jobId, (j) => {
      setProgress(`Consultando estados… ${j.completed}/${j.total || 32}`);
    });
    setIngesting(false);
    setProgress("");
    if (!job) {
      setError("El cálculo está tardando más de lo esperado. Refresca en un momento.");
      return;
    }
    if (job.status === "error") {
      setError(job.error ?? "No se pudo calcular el mapa.");
      return;
    }
    await load(termId);
  }

  const max = useMemo(
    () => (report?.available ? Math.max(...report.states.map((s) => s.count), 1) : 1),
    [report]
  );
  const top = useMemo(() => {
    if (!report?.available) return [];
    // "sin dato" no compite: un estado que no respondió no puede rankear.
    return report.states
      .filter((s) => s.status !== "missing")
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
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
            {terms.map((t) => {
              const label = queryLabel ? relationLabel(matchById.get(t.id) ?? null) : null;
              return (
                <option key={t.id} value={t.id}>
                  {label ? `${t.name} · ${label}` : t.name}
                </option>
              );
            })}
          </select>
          <Button variant="outline" onClick={() => void handleIngest()} disabled={ingesting || !termId}>
            <RefreshCw className={`mr-2 h-4 w-4 ${ingesting ? "animate-spin" : ""}`} />
            {ingesting ? (progress || "Consultando 32 estados…") : "Calcular mapa"}
          </Button>
        </div>
      </div>

      {queryLabel !== null && (
        <div className="mt-2 space-y-1 text-xs text-text-3">
          <p>
            {activeMatch?.exact ? (
              <>
                El mapa es de <strong className="font-medium text-text-2">«{activeName}»</strong>, el
                nicho que corresponde a «{queryLabel}». Este desglose por estado SÍ es el de tu
                búsqueda dentro del catálogo.
              </>
            ) : activeMatch && activeMatch.score > 0 ? (
              <>
                El mapa es de <strong className="font-medium text-text-2">«{activeName}»</strong>, un
                nicho {Math.round(activeMatch.score * 100)} % parecido a «{queryLabel}» por «
                {activeMatch.via}»; no es tu búsqueda.
              </>
            ) : (
              <>
                El mapa es de <strong className="font-medium text-text-2">«{activeName}»</strong>, un
                nicho de tu catálogo sin palabras en común con «{queryLabel}»; no describe tu
                búsqueda.
              </>
            )}
          </p>
          <p>
            {competition
              ? `DENUE sí midió «${queryLabel}» a nivel nacional: ${
                  competition.censored
                    ? `≥${competition.establishments}`
                    : competition.establishments.toLocaleString("es-MX")
                } establecimientos coincidentes. El desglose por estado solo está calculado para los nichos del catálogo.`
              : `DENUE no devolvió un conteo nacional para «${queryLabel}».`}{" "}
            Para tener su mapa, registra la búsqueda con «+ Monitorear» y después pulsa «Calcular
            mapa» (32 consultas, una por estado).
          </p>
        </div>
      )}

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
                // "sin dato" NO se colorea como 0: el azul significaría
                // "cero competidores" y es mentira.
                const missing = s.status === "missing";
                const alpha = missing ? 0 : 0.1 + 0.9 * (s.count / max);
                const dark = alpha > 0.55;
                const share =
                  s.sharePct === null ? "proporción no disponible" : `${s.sharePct.toFixed(1)}% del conteo`;
                return (
                  <div
                    key={s.code}
                    title={`${s.name}: ${cellLabel(s)}${missing ? "" : " establecimientos"} · ${share}${
                      s.status === "missing" ? " (el estado no respondió)" : ""
                    }`}
                    className="flex min-h-[44px] flex-col items-center justify-center rounded-[4px] border border-border/40 px-0.5"
                    style={{
                      gridColumn: s.col + 1,
                      gridRow: s.row + 1,
                      background: missing
                        ? "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(0,0,0,0.06) 4px, rgba(0,0,0,0.06) 8px)"
                        : `rgba(76, 110, 245, ${alpha.toFixed(3)})`,
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
                      {cellLabel(s)}{shareLabel(s)}
                    </span>
                  </li>
                ))}
              </ol>
                <p className="mt-3 text-[11px] leading-snug text-text-3">
                  Día {report.day} ·{" "}
                  {report.totalExact
                    ? `${report.totalLowerBound} coincidencias`
                    : `${report.totalLowerBound}+ coincidencias (lím. inferior)`}{" "}
                  en {32 - report.missingStates} de 32 estados
                  {report.missingStates > 0 ? ` · ${report.missingStates} sin dato` : ""}
                  {report.censoredStates > 0 ? " · ≥ = censura de la API" : ""}.
                </p>
            </div>
          </div>
          {report.censoredStates === report.states.length && report.missingStates === 0 && (
            <p className="mt-3 rounded-md border border-warning-soft bg-warning-tint p-3 text-xs text-warning-text">
              Los 32 estados devolvieron ≥10 establecimientos: DENUE censura la ventana de
              resultados, así que este mapa confirma presencia en todo el país pero no distingue
              estados ni da un total real. Es un límite de la fuente, no un empate de competencia.
            </p>
          )}
          <p className="mt-4 border-t pt-3 text-[11px] leading-snug text-text-3">
            Unidad: establecimientos públicos DENUE que coinciden con el término del nicho
            (conteo por ventana de 10; «≥10» = censurado; «sin dato» = el estado no
            respondió, NO es cero). Cuando hay censura o faltantes, el total es un límite
            inferior y no se muestran porcentajes. Las posiciones de los estados en
            la rejilla son aproximadas. Es un proxy de oferta/competencia local, NO de
            demanda. Fuente: DENUE · INEGI (directorio nacional de unidades económicas).
          </p>
        </>
      )}
    </section>
  );
}
