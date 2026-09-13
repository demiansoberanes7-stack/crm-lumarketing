"use client";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
type Connection = { baseUrl: string; sessionName: string; sessionStatus: string; apiKeyLast4: string; webhookUrl: string };
export function WahaClient() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [sessionName, setSessionName] = useState("default");
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const res = await fetch("/api/settings/whatsapp/waha");
    if (!res.ok) throw new Error("No se pudo consultar WAHA");
    const data = await res.json() as { connection: Connection | null };
    setConnection(data.connection);
    if (data.connection) { setBaseUrl(data.connection.baseUrl); setSessionName(data.connection.sessionName); }
  }, []);
  useEffect(() => { void load().catch((e: Error) => setError(e.message)); }, [load]);
  async function request(method: string, body: unknown) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/settings/whatsapp/waha", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Acción fallida");
      if (data.qr) setQr(data.qr);
      if (method === "PUT") setApiKey("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo conectar"); }
    finally { setBusy(false); }
  }
  return <section className="max-w-2xl space-y-4 rounded-lg border p-5">
    <h2 className="text-lg font-bold">WhatsApp · WAHA</h2>
    <Label htmlFor="waha-url">URL del servidor WAHA</Label><Input id="waha-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://waha.tudominio.com" />
    <Label htmlFor="waha-session">Sesión</Label><Input id="waha-session" value={sessionName} onChange={(e) => setSessionName(e.target.value)} />
    <Label htmlFor="waha-key">API key {connection ? `(guardada: …${connection.apiKeyLast4})` : ""}</Label><Input id="waha-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="new-password" />
    <Button disabled={busy || !baseUrl || !apiKey || !sessionName} onClick={() => void request("PUT", { baseUrl, apiKey, sessionName })}>Guardar conexión</Button>
    <p>Estado: <strong>{connection?.sessionStatus ?? "Sin configurar"}</strong></p>
    {connection && <label className="block text-sm">Webhook para sesiones existentes (message.any, message.ack, session.status)<Input readOnly value={connection.webhookUrl} /></label>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {([['start', 'Iniciar sesión'], ['stop', 'Detener sesión'], ['qr', 'Ver QR']] as const).map(([action, label]) => <Button key={action} variant="outline" disabled={busy || !connection} onClick={() => void request("POST", { action })}>{label}</Button>)}
      <Button variant="outline" disabled={busy} onClick={() => void load().catch((e: Error) => setError(e.message))}>Actualizar estado</Button>
    </div>
    {qr && <Image unoptimized src={qr} width={256} height={256} alt="QR para vincular WhatsApp con WAHA" />}
  </section>;
}
