"use client";
import { useEffect, useState } from "react";
export function WhatsappZernioClient() {
  const [accountId, setAccountId] = useState("");
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [last4, setLast4] = useState("");
  const [phone, setPhone] = useState("");
  const [webhook, setWebhook] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void fetch("/api/settings/whatsapp/zernio").then(async (res) => {
    if (!res.ok) throw new Error("No se pudo consultar Zernio. Se requiere una sesión de propietario.");
    const data = await res.json();
    setWebhook(data.webhookUrl);
    if (data.connection) { setAccountId(data.connection.accountId); setLast4(data.connection.tokenLast4); setPhone(data.connection.displayPhone); }
  }).catch((err: Error) => setNotice(err.message)); }, []);
  async function save(testOnly: boolean) {
    setBusy(true); setNotice("");
    try {
      const res = await fetch("/api/settings/whatsapp/zernio", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId, token, webhookSecret: secret, testOnly }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "No se pudo conectar Zernio");
      setPhone(data.displayPhone);
      if (!testOnly) { if (token) setLast4(token.slice(-4)); setToken(""); setSecret(""); }
      setNotice(testOnly ? "Número verificado en Zernio" : "Conexión guardada. Configura el webhook en el panel de Zernio con la URL de abajo.");
    } catch (err) { setNotice(err instanceof Error ? err.message : "Error de conexión"); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-lg border p-5">
    <h3 className="text-xl font-semibold">WhatsApp mediante Zernio</h3>
    <p className="text-sm text-text-2">Conecta tu número de WhatsApp Business en Zernio y copia aquí el Account ID, tu API key y el secreto de firma de su webhook.</p>
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
      <label className="block">Account ID de WhatsApp<input required className="mt-1 w-full rounded border bg-background p-2" value={accountId} onChange={(e) => setAccountId(e.target.value)} /></label>
      <label className="block">API key de Zernio<input type="password" autoComplete="new-password" className="mt-1 w-full rounded border bg-background p-2" placeholder={last4 ? `Guardada · …${last4}; vacío para conservar` : "API key de Zernio"} value={token} onChange={(e) => setToken(e.target.value)} /></label>
      <label className="block">Secreto de firma del webhook<input type="password" autoComplete="new-password" className="mt-1 w-full rounded border bg-background p-2" placeholder={last4 ? "Guardado; vacío para conservar" : "El mismo signing secret configurado en Zernio"} value={secret} onChange={(e) => setSecret(e.target.value)} /></label>
      <div className="flex gap-3"><button type="button" disabled={busy} className="rounded border px-4 py-2" onClick={() => void save(true)}>Probar Zernio</button><button disabled={busy} className="rounded bg-brand px-4 py-2 text-brand-fg">Guardar conexión Zernio</button></div>
    </form>
    {phone && <p>Número verificado: <strong>{phone}</strong></p>}
    <label className="block">URL del webhook en Zernio<input readOnly className="mt-1 w-full rounded border bg-background p-2 text-sm" value={webhook} /></label>
    <p className="text-sm text-text-2">Suscribe: message.received, message.sent, message.delivered, message.read y message.failed. Filtra por este Account ID. Usa el mismo secreto de firma; el CRM verifica X-Zernio-Signature.</p>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
