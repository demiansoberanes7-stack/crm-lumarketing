"use client";
import { useEffect, useState } from "react";
export function WhatsappProvider() {
  const [provider, setProvider] = useState("meta");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { void fetch("/api/settings/whatsapp/provider").then((r) => r.json()).then((d) => setProvider(d.provider)).catch(() => setMessage("No se pudo consultar el proveedor")); }, []);
  return <section className="rounded-lg border p-4 space-y-2">
    <label htmlFor="whatsapp-provider" className="block font-semibold">Proveedor activo de WhatsApp</label>
    <select id="whatsapp-provider" className="rounded border bg-background p-2" value={provider} disabled={busy} onChange={async (e) => {
      setBusy(true); setMessage("");
      const res = await fetch("/api/settings/whatsapp/provider", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: e.target.value }) }).catch(() => null);
      const data = await res?.json();
      if (res?.ok) { setProvider(data.provider); setMessage("Proveedor actualizado"); } else setMessage(data?.error?.message ?? "No se pudo cambiar el proveedor");
      setBusy(false);
    }}><option value="meta">WhatsApp · Meta Business</option><option value="waha">WAHA</option></select>
    <p className="text-sm text-text-2">Una conexión activa. El historial se conserva; WAHA necesita un teléfono para responder al contacto.</p>
    {message && <p role="status">{message}</p>}
  </section>;
}
