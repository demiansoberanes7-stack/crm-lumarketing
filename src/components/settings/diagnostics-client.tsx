"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Event = { id: string; source: string; severity: string; code: string; message: string; metadata: Record<string, unknown>; resolved_at: string | null; created_at: string | null };
type Data = { events: Event[]; nextCursor: string | null; status: { database: string; provider: string; zernio: string; meta: string; waha: string; instagram: string; messenger: string; tiktok: string; emailAccounts: number } };
const labels: Record<string, string> = { connected: "Credenciales guardadas", reconnect_required: "Requiere reconexión", not_configured: "Sin configurar", disabled: "Desactivado en el servidor" };

/** Qué significa cada código, en una frase, y qué puede hacer la persona. */
const EXPLAIN: Record<string, { what: string; fix: string }> = {
  api_failed: { what: "Una acción del sistema no se pudo completar.", fix: "Vuelve a intentar la acción. Si se repite, revisa la integración del módulo donde ocurrió." },
  connection_failed: { what: "No se pudo conectar con el proveedor externo.", fix: "Revisa credenciales, permisos y que el servicio del proveedor esté disponible." },
  connection_saved: { what: "La conexión se guardó y se verificó correctamente.", fix: "No requiere acción." },
  provider_activated: { what: "El proveedor de WhatsApp quedó activo.", fix: "No requiere acción." },
  disconnected: { what: "La conexión con el canal se desconectó.", fix: "Vuelve a conectar el canal desde su configuración." },
  webhook_failed: { what: "Llegó un aviso del proveedor, pero no se pudo procesar.", fix: "El proveedor puede reintentarlo. Revisa la configuración del webhook si se repite." },
  webhook_received: { what: "Aviso del proveedor recibido y procesado.", fix: "No requiere acción." },
  subscription_failed: { what: "Las credenciales se guardaron, pero Meta no confirmó la suscripción.", fix: "Entra a WhatsApp Cloud API y repara la suscripción; luego guarda de nuevo." },
  session_changed: { what: "Cambió el estado de la sesión de WhatsApp (WAHA).", fix: "Si quedó desconectada, escanea el código QR desde WAHA." },
  session_action: { what: "Se ejecutó una acción sobre la sesión de WAHA.", fix: "No requiere acción." },
  send_failed: { what: "El mensaje no se pudo enviar.", fix: "Revisa la conexión del canal y el detalle del mensaje en la conversación." },
  media_failed: { what: "No se pudo descargar el archivo adjunto.", fix: "Revisa la conexión y que el archivo siga disponible en el proveedor." },
  ai_failed: { what: "El proveedor de IA no pudo completar su respuesta.", fix: "Revisa token, modelo y disponibilidad del servicio de IA." },
  tasks_sync_failed: { what: "La tarea se guardó, pero no se agendó en Google Calendar.", fix: "Se reintenta al editar la tarea; revisa la conexión de Calendar." },
  email_sync_failed: { what: "No se pudo sincronizar la cuenta de correo.", fix: "Revisa los datos IMAP y el estado del servidor de correo." },
};

const SEVERITY: Record<string, { label: string; cls: string }> = {
  error: { label: "Error", cls: "border-danger-soft bg-danger-tint text-danger-text" },
  warning: { label: "Advertencia", cls: "border-warning-soft bg-warning-tint text-warning-text" },
  info: { label: "Información", cls: "border-border bg-subtle text-text-2" },
};

function when(iso: string | null): { text: string; title: string } {
  if (!iso) return { text: "—", title: "" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { text: "—", title: "" };
  return {
    text: date.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }),
    title: date.toISOString(),
  };
}

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
      {([ ["zernio", "WhatsApp · Zernio", "/settings/whatsapp"], ["waha", "WAHA", "/settings/waha"], ["instagram", "Instagram", "/settings/instagram"], ["messenger", "Messenger", "/settings/messenger"], ["tiktok", "TikTok", "/settings/tiktok"] ] as const).map(([key, label, href]) => <Link key={key} href={href} className="rounded border p-4"><strong>{label}</strong><p>{labels[data.status[key]] ?? data.status[key]}</p>{data.status.provider === key && <span className="text-xs">Proveedor activo</span>}</Link>)}
      <Link href="/settings/email" className="rounded border p-4"><strong>Buzón</strong><p>{data.status.emailAccounts} cuentas configuradas</p></Link>
    </section>}
    <p className="text-sm text-text-2">Los estados de credenciales no equivalen a una prueba en vivo. Abre cada integración para probarla. Los errores de arranque o de una base inaccesible se consultan en EasyPanel.</p>
    <div className="flex flex-wrap gap-3">
      <label>Origen <select className="rounded border bg-background p-2" value={source} onChange={(e) => setSource(e.target.value)}><option value="">Todos</option>{["api", "meta", "waha", "instagram", "messenger", "tiktok", "email", "ai", "media", "webhook"].map((s) => <option key={s}>{s}</option>)}</select></label>
      <label>Nivel <select className="rounded border bg-background p-2" value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="">Todos</option><option value="error">Error</option><option value="warning">Advertencia</option><option value="info">Información</option></select></label>
      <button className="rounded border px-3" disabled={busy} onClick={() => void load()}>{busy ? "Cargando…" : "Actualizar"}</button>
    </div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <section className="space-y-3" aria-label="Eventos recientes">
      {data?.events.length === 0 && <p>No hay eventos para estos filtros.</p>}
      {data?.events.map((event) => {
        const explain = EXPLAIN[event.code];
        const badge = SEVERITY[event.severity] ?? { label: event.severity, cls: "border-border bg-subtle text-text-2" };
        const stamp = when(event.created_at);
        const providerCode = typeof event.metadata?.errorCode === "string" ? event.metadata.errorCode : null;
        return <article key={event.id} className="rounded-lg border bg-card p-4 shadow-xs">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
              <strong className="text-sm">{event.source}</strong>
              {event.resolved_at && <span className="rounded-full border border-success-soft bg-success-tint px-2 py-0.5 text-[11px] font-medium text-success-text">Resuelto</span>}
            </div>
            <time className="text-xs text-text-3" dateTime={event.created_at ?? undefined} title={stamp.title}>{stamp.text}</time>
          </div>
          <p className="mt-2 text-sm font-medium">{explain?.what ?? event.message}</p>
          {explain && <p className="mt-1 text-sm text-text-2"><span className="font-medium text-text-2">Qué hacer: </span>{explain.fix}</p>}
          <p className="mt-2 text-[11px] text-text-3">
            Código: {event.code}{providerCode ? ` · proveedor: ${providerCode}` : ""}
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-text-2">Detalles técnicos (credenciales y tokens ocultos)</summary>
            <pre className="mt-2 max-h-[24rem] overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-[11px]">{JSON.stringify(event.metadata, null, 2)}</pre>
          </details>
          <button className="mt-3 rounded border px-3 py-1 text-sm" onClick={() => void resolve(event)}>{event.resolved_at ? "Resuelto · Reabrir" : "Marcar resuelto"}</button>
        </article>;
      })}
    </section>
    {data?.nextCursor && <button className="rounded border p-2" disabled={busy} onClick={() => void load(data.nextCursor!)}>Ver anteriores</button>}
  </div>;
}
