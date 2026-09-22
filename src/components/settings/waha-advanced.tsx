"use client";
import { useState } from "react";
import { DEFAULT_WAHA_SETTINGS, type WahaSettings } from "@/lib/waha-settings";

export function WahaAdvanced({ initial, engine, busy, onSave }: { initial: WahaSettings | null; engine: string | null; busy: boolean; onSave: (settings: WahaSettings) => Promise<boolean> }) {
  const [settings, setSettings] = useState(initial ?? DEFAULT_WAHA_SETTINGS);
  const set = <K extends keyof WahaSettings>(key: K, value: WahaSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  return <section className="rounded border p-4" aria-label="Configuración avanzada de sesión"><h3 className="font-semibold">Configuración avanzada de sesión</h3>
    <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void onSave(settings).then((saved) => { if (saved) set("proxyPassword", ""); }); }}>
      <p className="text-sm text-text-2">Motor detectado: {engine ?? "no disponible"}. El motor se elige en el servidor WAHA con WHATSAPP_DEFAULT_ENGINE. Aplicar puede reiniciar la sesión.</p>
      <label className="block">Nombre del dispositivo<input className="mt-1 w-full rounded border bg-background p-2" maxLength={80} value={settings.deviceName} onChange={(e) => set("deviceName", e.target.value)} /></label>
      <label className="block">Navegador<select className="ml-3 rounded border bg-background p-2" value={settings.browserName} onChange={(e) => set("browserName", e.target.value as WahaSettings["browserName"])}>{["Chrome", "Firefox", "Safari", "Edge", "Opera"].map((v) => <option key={v}>{v}</option>)}</select></label>
      <p className="text-xs text-text-2">En GOWS, usa WAHA_CLIENT_DEVICE_NAME y WAHA_CLIENT_BROWSER_NAME en el servidor; los nombres por sesión solo aplican a los motores compatibles.</p>
      {([["ignoreStatus", "Ignorar estados"], ["ignoreGroups", "Ignorar grupos"], ["ignoreChannels", "Ignorar canales"], ["ignoreBroadcast", "Ignorar listas de difusión"], ["nowebStore", "NOWEB: guardar historial local"], ["nowebFullSync", "NOWEB: sincronización completa"], ["webjsTagsEvents", "WEBJS: activar acuses de entrega (tagsEventsOn)"]] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings[key]} onChange={(e) => set(key, e.target.checked)} />{label}</label>)}
      <p className="text-xs text-text-2">Los filtros controlan los eventos emitidos por WAHA. La bandeja del CRM atiende conversaciones individuales.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label htmlFor="waha-retry-policy">Reintentos<select id="waha-retry-policy" aria-label="Reintentos" className="mt-1 w-full rounded border bg-background p-2" value={settings.retryPolicy} onChange={(e) => set("retryPolicy", e.target.value as WahaSettings["retryPolicy"])}><option value="constant">Constante</option><option value="linear">Lineal</option><option value="exponential">Exponencial</option></select></label>
        <label>Demora (segundos)<input type="number" min={1} max={300} required className="mt-1 w-full rounded border bg-background p-2" value={settings.retryDelaySeconds} onChange={(e) => set("retryDelaySeconds", Number(e.target.value))} /></label>
        <label>Intentos<input type="number" min={1} max={20} required className="mt-1 w-full rounded border bg-background p-2" value={settings.retryAttempts} onChange={(e) => set("retryAttempts", Number(e.target.value))} /></label>
      </div>
      <label className="block">Proxy (host:puerto; vacío para desactivar)<input className="mt-1 w-full rounded border bg-background p-2" placeholder="proxy.ejemplo.com:3128" value={settings.proxyServer} onChange={(e) => set("proxyServer", e.target.value)} /></label>
      <label className="block">Usuario del proxy<input className="mt-1 w-full rounded border bg-background p-2" value={settings.proxyUsername} onChange={(e) => set("proxyUsername", e.target.value)} /></label>
      <label className="block">Contraseña del proxy<input type="password" autoComplete="new-password" className="mt-1 w-full rounded border bg-background p-2" placeholder="Vacío conserva la guardada para el mismo proxy y usuario" value={settings.proxyPassword ?? ""} onChange={(e) => set("proxyPassword", e.target.value)} /></label>
      <button disabled={busy} className="rounded border px-4 py-2">Aplicar configuración de sesión</button>
    </form>
    <div className="mt-4 space-y-1 text-xs text-text-2"><p>Variables del despliegue WAHA: WAHA_API_KEY, WHATSAPP_DEFAULT_ENGINE, WAHA_CLIENT_DEVICE_NAME, WAHA_CLIENT_BROWSER_NAME, WHATSAPP_START_SESSION.</p><p>En el CRM: APP_BASE_URL debe ser la URL pública HTTPS; WAHA_TRUSTED_HOSTS autoriza el host del servidor. El webhook y su firma HMAC se configuran automáticamente.</p></div>
  </section>;
}
