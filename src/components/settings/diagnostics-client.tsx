"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Event = { id: string; source: string; severity: string; code: string; message: string; metadata: Record<string, unknown>; resolved_at: string | null; created_at: string };
type Data = { events: Event[]; nextCursor: string | null; status: { database: string; provider: string; meta: string; waha: string; instagram: string; messenger: string; emailAccounts: number } };
const labels: Record<string, string> = { connected: "Credenciales guardadas", reconnect_required: "Requiere reconexión", not_configured: "Sin configurar" };
export function DiagnosticsClient() {
  const [data, setData] = useState<Data | null>(null);
  const [source, setSource] = useState("");
  const [severity, setSeverity] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (before?: string) => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams();
      if (source) params.set("source", source);
      if (severity) params.set("severity", severity);
      if (before) params.set("before", before);
      const res = await fetch(`/api/settings/diagnostics?${params}`);
      if (!res.ok) throw new Error("No se pudo cargar Diagnóstico. Verifica tu sesión y el estado del servidor.");
      const next = await res.json() as Data;
      setData((old) => before && old ? { ...next, events: [...old.events, ...next.events] } : next);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de conexión"); }
    finally { setBusy(false); }
  }, [source, severity]);
  useEffect(() => { void load(); }, [load]);
  async function resolve(event: Event) {
    const res = await fetch("/api/settings/diagnostics", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: event.id, resolved: !event.resolved_at }) }).catch(() => null);
    if (!res?.ok) { setError("No se pudo actualizar el evento"); return; }
    await load();
  }
  return <div className="max-w-5xl space-y-6">
    <header><h3 className="text-xl font-semibold">Diagnóstico y errores</h3><p className="text-sm text-text-2">Eventos operativos de los últimos 30 días. Acceso exclusivo del propietario.</p></header>
    {data && <section className="grid gap-3 sm:grid-cols-3" aria-label="Estado del sistema">
      <div className="rounded border p-4"><strong>PostgreSQL</strong><p>{data.status.database}</p></div>
      {([ ["meta", "WhatsApp Cloud API", "/settings/whatsapp"], ["waha", "WAHA", "/settings/waha"], ["instagram", "Instagram", "/settings/instagram"], ["messenger", "Messenger", "/settings/messenger"] ] as const).map(([key, label, href]) => <Link key={key} href={href} className="rounded border p-4"><strong>{label}</strong><p>{labels[data.status[key]] ?? data.status[key]}</p>{data.status.provider === key && <span className="text-xs">Proveedor seleccionado</span>}</Link>)}
      <Link href="/settings/email" className="rounded border p-4"><strong>Buzón</strong><p>{data.status.emailAccounts} cuentas configuradas</p></Link>
    </section>}
    <p className="text-sm text-text-2">Los estados de credenciales no equivalen a una prueba en vivo. Abre cada integración para probarla. Los errores de arranque o de una base inaccesible se consultan en EasyPanel.</p>
    <div className="flex flex-wrap gap-3">
      <label>Origen <select className="rounded border bg-background p-2" value={source} onChange={(e) => setSource(e.target.value)}><option value="">Todos</option>{["api", "meta", "waha", "instagram", "messenger", "email", "ai", "media"].map((s) => <option key={s}>{s}</option>)}</select></label>
      <label>Nivel <select className="rounded border bg-background p-2" value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="">Todos</option><option value="error">Error</option><option value="warning">Advertencia</option><option value="info">Información</option></select></label>
      <button className="rounded border px-3" disabled={busy} onClick={() => void load()}>{busy ? "Cargando…" : "Actualizar"}</button>
    </div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <section className="space-y-3" aria-label="Eventos recientes">
      {data?.events.length === 0 && <p>No hay eventos para estos filtros.</p>}
      {data?.events.map((event) => <article key={event.id} className="rounded border p-4 space-y-2">
        <div className="flex flex-wrap justify-between gap-2"><strong>{event.source} · {event.severity}</strong><time>{new Date(event.created_at).toLocaleString("es-MX")}</time></div>
        <p>{event.message}</p><p className="text-xs text-text-2">Código: {event.code} · {event.id}</p>
        <details><summary className="cursor-pointer text-sm">Detalle técnico seguro</summary><pre className="overflow-auto text-xs">{JSON.stringify(event.metadata, null, 2)}</pre></details>
        <button className="rounded border px-3 py-1 text-sm" onClick={() => void resolve(event)}>{event.resolved_at ? "Resuelto · Reabrir" : "Marcar resuelto"}</button>
      </article>)}
    </section>
    {data?.nextCursor && <button className="rounded border p-2" disabled={busy} onClick={() => void load(data.nextCursor!)}>Ver anteriores</button>}
  </div>;
}
