"use client";

import { useCallback, useEffect, useState } from "react";
import { Plug, Save, Trash2, CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Connection = {
  status: "connected" | "reconnect_required" | "error";
  clientId: string;
  userId: string | null;
  siteId: string | null;
  clientSecretLast4: string;
  refreshTokenSet: boolean;
  lastPolledAt: string | null;
} | null;

export function MercadoLibreClient() {
  const [connection, setConnection] = useState<Connection>(null);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/settings/mercado-libre", { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => null) as { connection: Connection } | null;
      setConnection(data?.connection ?? null);
      if (data?.connection) setClientId(data.connection.clientId);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/settings/mercado-libre", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), refreshToken: refreshToken.trim() }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      const data = await res.json().catch(() => null) as { vendor?: { userId?: string | null; siteId?: string | null }; unreadPacks?: number | null; unreadError?: string } | null;
      const packs = data?.unreadPacks != null ? ` · ${data.unreadPacks} conversación(es) sin leer` : "";
      const warning = data?.unreadError ? ` (aviso de lectura: ${data.unreadError})` : "";
      setMessage({ ok: true, text: `Cuenta conectada${packs}${warning}` });
      setClientSecret("");
      setRefreshToken("");
      void refresh();
    } else {
      const data = await res?.json().catch(() => null) as { error?: string } | null;
      setMessage({ ok: false, text: data?.error ?? "No se pudieron validar las credenciales de Mercado Libre" });
    }
  };

  const disconnect = async () => {
    if (!window.confirm("¿Desconectar Mercado Libre? Los mensajes ya ingeridos se conservan en la Bandeja.")) return;
    setDeleting(true);
    await fetch("/api/settings/mercado-libre", { method: "DELETE" }).catch(() => null);
    setDeleting(false);
    setConnection(null);
    setClientId("");
    setMessage({ ok: true, text: "Cuenta desconectada" });
  };

  return (
    <section aria-label="Mercado Libre" className="space-y-5">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand-text">
          <Plug className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Mercado Libre</h1>
          <p className="mt-1 text-sm text-text-2">
            Mensajes post-venta (chats por orden/compra) de tu cuenta vendedora. La app de
            desarrollador debe tener el scope de mensajería — la guía completa está en{" "}
            <code className="font-mono text-foreground">docs/mercado-libre.md</code>.
          </p>
        </div>
      </header>

      <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
        {loading ? (
          <p className="text-sm text-text-2">Consultando…</p>
        ) : connection ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              {connection.status === "connected"
                ? <CheckCircle2 className="h-4 w-4 text-success-text" />
                : <CircleAlert className="h-4 w-4 text-warning-text" />}
              <span>
                {connection.status === "connected"
                  ? "Cuenta conectada"
                  : connection.status === "reconnect_required"
                    ? "Requiere reconexión: el refresh token fue rechazado"
                    : "Error de conexión: revisa la app en Mercado Libre"}
              </span>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-text-3">Vendedor</dt><dd className="font-mono">{connection.userId ?? "—"}</dd></div>
              <div><dt className="text-text-3">Sitio</dt><dd className="font-mono">{connection.siteId ?? "—"}</dd></div>
              <div><dt className="text-text-3">Client ID</dt><dd className="font-mono">{connection.clientId}</dd></div>
              <div><dt className="text-text-3">Última lectura</dt><dd>{connection.lastPolledAt ? new Date(connection.lastPolledAt).toLocaleString("es-MX") : "—"}</dd></div>
            </dl>
            <Button type="button" variant="outline" onClick={() => void disconnect()} disabled={deleting}>
              <Trash2 className="h-4 w-4" /> {deleting ? "Desconectando…" : "Desconectar"}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-text-2">
            Sin cuenta conectada. Pega el Client ID, Client Secret y Refresh Token de tu app
            de Mercado Libre (guía en <code className="font-mono">docs/mercado-libre.md</code>).
          </p>
        )}
      </div>

      <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
        <h2 className="font-semibold">{connection ? "Actualizar credenciales" : "Conectar cuenta"}</h2>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => { e.preventDefault(); void save(); }}
        >
          <div className="space-y-2">
            <Label htmlFor="ml-client-id">Client ID de la aplicación</Label>
            <Input id="ml-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} required autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ml-client-secret">Client Secret</Label>
            <Input id="ml-client-secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} required={!connection} autoComplete="off" placeholder={connection ? `••••${connection.clientSecretLast4}` : ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ml-refresh-token">Refresh Token</Label>
            <Input id="ml-refresh-token" type="password" value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} required={!connection} autoComplete="off" placeholder={connection?.refreshTokenSet ? "•••• (guardado)" : ""} />
          </div>
          {message && (
            <p role={message.ok ? "status" : "alert"} className={message.ok ? "rounded-md border border-success-soft bg-success-tint p-3 text-sm text-success-text" : "rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text"}>
              {message.text}
            </p>
          )}
          <Button type="submit" disabled={saving}>
            <Save className="h-4 w-4" /> {saving ? "Validando con Mercado Libre…" : "Guardar y verificar"}
          </Button>
        </form>
      </div>
    </section>
  );
}
