"use client";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { WahaAdvanced } from "./waha-advanced";
import type { WahaSettings } from "@/lib/waha-settings";
type Connection = { baseUrl: string; sessionName: string; apiKeyLast4: string; sessionStatus: string; webhookUrl: string; error: string | null; account: string | null; restrictions: unknown; settings: WahaSettings | null; engine: string | null };
export function WahaClient() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [sessionName, setSessionName] = useState("default");
  const [apiKey, setApiKey] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async (initialize = false) => {
    const res = await fetch("/api/settings/whatsapp/waha");
    if (!res.ok) throw new Error("No se pudo consultar WAHA; se requiere una sesión de propietario");
    const data = await res.json() as { connection: Connection | null };
    setConnection(data.connection);
    if (initialize && data.connection) { setBaseUrl(data.connection.baseUrl); setSessionName(data.connection.sessionName); }
    if (data.connection?.sessionStatus !== "SCAN_QR_CODE") setQr(null);
  }, []);
  useEffect(() => { void load(true).catch((e: Error) => setNotice(e.message)); }, [load]);
  useEffect(() => {
    if (!connection) return;
    const timer = setInterval(() => { void load().catch(() => setNotice("No se pudo actualizar el estado")); }, 10000);
    return () => clearInterval(timer);
  }, [connection, load]);
  useEffect(() => {
    if (!qr || connection?.sessionStatus !== "SCAN_QR_CODE") return;
    const timer = setInterval(() => {
      void fetch("/api/settings/whatsapp/waha", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "qr" }) }).then(async (res) => { if (res.ok) { const data = await res.json(); setQr(data.qr); } }).catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, [qr, connection?.sessionStatus]);
  async function request(method: string, body?: unknown) {
    setBusy(true); setNotice("");
    try {
      const res = await fetch("/api/settings/whatsapp/waha", { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "No se pudo completar la acción");
      if (data.qr) setQr(data.qr);
      if (method === "PUT") setApiKey("");
      await load();
      setNotice(data.sessionStatus ? `Estado: ${data.sessionStatus}` : "Operación completada");
    } catch (e) { setNotice(e instanceof Error ? e.message : "Error de conexión"); }
    finally { setBusy(false); }
  }
  return <div className="max-w-3xl space-y-5">
    <header><h3 className="text-xl font-semibold">WAHA</h3><p className="text-sm text-text-2">Conecta tu servidor WAHA y vincula WhatsApp mediante QR. La API key permanece en el servidor del CRM.</p></header>
    <form className="rounded border p-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void request("PUT", { baseUrl, sessionName, apiKey }); }}>
      <label className="block">URL del servidor<input className="mt-1 w-full rounded border bg-background p-2" required type="url" placeholder="https://waha.tudominio.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></label>
      <label className="block">Sesión<input className="mt-1 w-full rounded border bg-background p-2" required value={sessionName} onChange={(e) => setSessionName(e.target.value)} /></label>
      <label className="block">API key<input className="mt-1 w-full rounded border bg-background p-2" type="password" autoComplete="new-password" placeholder={connection ? `Guardada · …${connection.apiKeyLast4}; deja vacío para conservar` : "X-Api-Key"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></label>
      <button className="rounded border px-4 py-2" disabled={busy}>Probar y guardar servidor</button>
    </form>
    {connection && <section className="rounded border p-4 space-y-3">
      <p><strong>Estado:</strong> {connection.sessionStatus} {connection.account && `· ${connection.account}`}</p>
      {connection.error && <p role="alert">{connection.error}</p>}
      <div className="flex flex-wrap gap-2">{([ ["test", "Probar conexión"], ["start", "Iniciar y configurar webhook"], ["qr", "Mostrar QR"], ["stop", "Detener"], ["restart", "Reiniciar"], ["webhook", "Reparar webhook"] ] as const).map(([action, label]) => <button key={action} disabled={busy} className="rounded border px-3 py-2" onClick={() => void request("POST", { action })}>{label}</button>)}</div>
      <p className="text-xs text-text-2">Reparar el webhook conserva las demás opciones de la sesión; WAHA puede reiniciarla al aplicar cambios.</p>
      {qr && <Image unoptimized src={qr} width={256} height={256} alt="QR para vincular WhatsApp a WAHA" className="h-64 w-64 bg-white p-2" />}
      {connection.sessionStatus.startsWith("PASSKEY") && <p>WhatsApp solicita una confirmación adicional. Complétala desde tu teléfono y el panel WAHA; el CRM actualizará el estado automáticamente.</p>}
      <label className="block text-sm">Webhook del CRM<input className="mt-1 w-full rounded border bg-background p-2" readOnly value={connection.webhookUrl} /></label>
      <button className="rounded border px-3 py-1" onClick={() => void navigator.clipboard.writeText(connection.webhookUrl).then(() => setNotice("URL copiada")).catch(() => setNotice("Selecciona y copia la URL manualmente"))}>Copiar webhook</button>
      <p className="text-xs">Eventos: message.any, message.ack, session.status. Firma HMAC SHA-512 y reintentos automáticos al configurar.</p>
      {connection.restrictions ? <details><summary>Restricciones informadas por WhatsApp</summary><pre className="overflow-auto text-xs">{JSON.stringify(connection.restrictions as Record<string, unknown>, null, 2)}</pre></details> : null}
      <div className="flex gap-3"><button disabled={busy} className="rounded border p-2" onClick={() => { if (confirm("¿Cerrar sesión en WhatsApp? Necesitarás vincularlo de nuevo.")) void request("POST", { action: "logout" }); }}>Cerrar sesión WhatsApp</button><button disabled={busy} className="rounded border p-2" onClick={() => { if (confirm("¿Eliminar la conexión guardada del CRM? El historial se conserva.")) void request("DELETE"); }}>Desconectar del CRM</button></div>
    </section>}
    {connection && <WahaAdvanced key={`${connection.baseUrl}/${connection.sessionName}/${connection.settings !== null}`} initial={connection.settings} engine={connection.engine} busy={busy} onSave={(settings) => request("POST", { action: "configure", settings })} />}
    {notice && <p role="status" className="rounded border p-3">{notice}</p>}
  </div>;
}
