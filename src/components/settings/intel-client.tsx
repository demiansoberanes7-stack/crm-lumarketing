"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Plug, RefreshCw, Save, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Connection = {
  youtubeKeyLast4: string;
  denueConfigured: boolean;
  lastIngestAt: string | null;
  status: "connected" | "error";
} | null;

/**
 * API keys del módulo de inteligencia: YouTube Data API (gratis en Google
 * Cloud) y token DENUE (gratis por email INEGI). Patrón Google Business:
 * las claves se guardan cifradas y jamás regresan al cliente.
 */
export function IntelSettingsClient() {
  const [connection, setConnection] = useState<Connection>(null);
  const [loading, setLoading] = useState(true);
  const [youtubeKey, setYoutubeKey] = useState("");
  const [denueToken, setDenueToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/settings/intel", { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => null) as { connection: Connection } | null;
      setConnection(data?.connection ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/settings/intel", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        youtubeKey,
        denueToken: denueToken.trim() || null,
      }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      setMessage({ ok: true, text: "Guardado. Ya puedes actualizar el feed desde Inteligencia." });
      setYoutubeKey("");
      setDenueToken("");
      await refresh();
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setMessage({ ok: false, text: data?.error?.message ?? "No se pudieron verificar las credenciales." });
    }
  }

  async function handleIngest() {
    setIngesting(true);
    setMessage(null);
    const res = await fetch("/api/intel/ingest", { method: "POST" }).catch(() => null);
    setIngesting(false);
    if (res?.ok) {
      const data = await res.json().catch(() => null) as { videosAnalyzed?: number; termsMatched?: number } | null;
      setMessage({
        ok: true,
        text: `Feed actualizado: ${data?.videosAnalyzed ?? 0} videos analizados, ${data?.termsMatched ?? 0} nicho(s) con coincidencias.`,
      });
      await refresh();
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setMessage({ ok: false, text: data?.error?.message ?? "No se pudo actualizar el feed." });
    }
  }

  async function handleDisconnect() {
    await fetch("/api/settings/intel", { method: "DELETE" }).catch(() => null);
    setConnection(null);
    setMessage({ ok: true, text: "Credenciales eliminadas." });
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Inteligencia de Mercado</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-2">
          El módulo de Inteligencia usa fuentes gratuitas: la API de YouTube (feed popular de México)
          y DENUE del INEGI (directorio de establecimientos). Pega aquí tus claves; se guardan
          cifradas y solo se muestra su último fragmento.
        </p>
      </header>

      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`flex items-start gap-2 rounded-md border p-3 text-sm ${message.ok ? "border-success/30 bg-success/10 text-success" : "border-danger-soft bg-danger-tint text-danger-text"}`}
        >
          {message.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          {message.text}
        </p>
      )}

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-semibold">
          <Plug className="h-4 w-4 text-brand-text" /> Credenciales
          {connection && (
            <span className="ml-auto text-xs font-medium text-success">Configuradas</span>
          )}
        </h2>
        {loading ? (
          <p className="mt-3 text-sm text-text-2">Consultando…</p>
        ) : connection ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-text-2">
              YouTube API key ····{connection.youtubeKeyLast4}
              {connection.denueConfigured && <> · DENUE configurado</>}
              {connection.lastIngestAt && (
                <> · último feed {new Date(connection.lastIngestAt).toLocaleString("es-MX")}</>
              )}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void handleIngest()} disabled={ingesting} variant="outline">
                <RefreshCw className={`mr-2 h-4 w-4 ${ingesting ? "animate-spin" : ""}`} />
                {ingesting ? "Actualizando…" : "Actualizar feed de datos ahora"}
              </Button>
              <Button onClick={() => void handleDisconnect()} variant="ghost" className="text-danger-text">
                <Trash2 className="mr-2 h-4 w-4" /> Eliminar credenciales
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSave(e)} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>YouTube Data API key (requerida)</Label>
                <Input
                  type="password"
                  value={youtubeKey}
                  onChange={(e) => setYoutubeKey(e.target.value)}
                  required
                  placeholder="AIza…"
                />
                <p className="mt-1 text-[11px] leading-snug text-text-3">
                  Gratis: console.cloud.google.com → YouTube Data API v3 → Habilitar →
                  Credenciales → Clave de API. Al guardar, el CRM verifica la leyendo el feed
                  popular de México (1 unidad de cuota).
                </p>
              </div>
              <div>
                <Label>Token DENUE · INEGI (opcional)</Label>
                <Input
                  type="password"
                  value={denueToken}
                  onChange={(e) => setDenueToken(e.target.value)}
                  placeholder="Token de 32 caracteres"
                />
                <p className="mt-1 text-[11px] leading-snug text-text-3">
                  Gratis por correo: inegi.org.mx/servicios/api_denue.html → Obtener token.
                  Habilita el conteo de establecimientos (competencia) en los informes.
                </p>
              </div>
            </div>
            <Button type="submit" disabled={saving}>
              <Save className="mr-2 h-4 w-4" /> {saving ? "Verificando contra YouTube…" : "Guardar"}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
