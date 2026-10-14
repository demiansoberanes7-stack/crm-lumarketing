"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Plug,
  RefreshCw,
  Save,
  Search,
  Trash2,
  TrendingUp,
  Video,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* ── Tipos ───────────────────────────────────────────────────────────────── */

type Connection = {
  youtubeKeyLast4: string;
  youtubeStatus: "ok" | "error" | null;
  youtubeLastTestAt: string | null;
  denueConfigured: boolean;
  denueStatus: "ok" | "error" | null;
  denueLastTestAt: string | null;
  gtEnabled: boolean;
  gtStatus: "ok" | "error" | null;
  gtLastTestAt: string | null;
  gtLastSyncAt: string | null;
  lastIngestAt: string | null;
  status: "connected" | "error";
} | null;

type SourceStatus = "ok" | "error" | null;

/* ── Helpers de badge ────────────────────────────────────────────────────── */

function StatusBadge({ status, saved }: { status: SourceStatus; saved: boolean }) {
  if (status === "ok") {
    return (
      <Badge variant="outline" className="border-success-soft bg-success-tint text-success-text">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Conectado
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="outline" className="border-danger-soft bg-danger-tint text-danger-text">
        <XCircle className="mr-1 h-3 w-3" /> Error
      </Badge>
    );
  }
  if (saved) {
    return (
      <Badge variant="outline" className="border-warning-soft bg-warning-tint text-warning-text">
        Guardado (sin probar)
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-border bg-subtle text-text-3">
      No configurado
    </Badge>
  );
}

/* ── Componente principal ────────────────────────────────────────────────── */

/**
 * Credenciales del módulo de inteligencia: 3 tarjetas INDIVIDUALES
 * (YouTube, DENUE, Google Trends) con badge verde/rojo vivo según el último
 * test en vivo. Distingue «Guardado» (cifrado en BD) de «Conectado» (probado
 * hoy contra el servicio real). Cada tarjeta tiene su propio botón «Probar
 * conexión».
 */
export function IntelSettingsClient() {
  const [connection, setConnection] = useState<Connection>(null);
  const [loading, setLoading] = useState(true);

  // YouTube
  const [youtubeKey, setYoutubeKey] = useState("");
  const [savingYoutube, setSavingYoutube] = useState(false);
  const [testingYoutube, setTestingYoutube] = useState(false);

  // DENUE
  const [denueToken, setDenueToken] = useState("");
  const [savingDenue, setSavingDenue] = useState(false);
  const [testingDenue, setTestingDenue] = useState(false);

  // Google Trends
  const [gtEnabled, setGtEnabled] = useState(false);
  const [savingGt, setSavingGt] = useState(false);
  const [testingGt, setTestingGt] = useState(false);

  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/settings/intel", { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => null) as { connection: Connection } | null;
      setConnection(data?.connection ?? null);
      if (data?.connection?.gtEnabled !== undefined) {
        setGtEnabled(data.connection.gtEnabled);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /* ── YouTube ───────────────────────────────────────────────────────────── */

  async function handleSaveYoutube(e: React.FormEvent) {
    e.preventDefault();
    setSavingYoutube(true);
    setMessage(null);
    const res = await fetch("/api/settings/intel", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        youtubeKey,
        denueToken: connection?.denueConfigured ? undefined : null,
        gtEnabled: connection?.gtEnabled ?? false,
      }),
    }).catch(() => null);
    setSavingYoutube(false);
    if (res?.ok) {
      setMessage({ ok: true, text: "YouTube guardado. Prueba la conexión para confirmar." });
      setYoutubeKey("");
      await refresh();
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setMessage({ ok: false, text: data?.error?.message ?? "No se pudo guardar YouTube." });
    }
  }

  async function handleTestYoutube() {
    setTestingYoutube(true);
    setMessage(null);
    const res = await fetch("/api/settings/intel/youtube/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ youtubeKey: youtubeKey || `····${connection?.youtubeKeyLast4}` }),
    }).catch(() => null);
    setTestingYoutube(false);
    if (res?.ok) {
      setMessage({ ok: true, text: "YouTube responde correctamente." });
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setMessage({ ok: false, text: data?.error?.message ?? "YouTube no respondió." });
    }
    await refresh();
  }

  /* ── DENUE ────────────────────────────────────────────────────────────── */

  async function handleSaveDenue(e: React.FormEvent) {
    e.preventDefault();
    setSavingDenue(true);
    setMessage(null);
    const res = await fetch("/api/settings/intel", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        youtubeKey: `····${connection?.youtubeKeyLast4}`,
        denueToken,
        gtEnabled: connection?.gtEnabled ?? false,
      }),
    }).catch(() => null);
    setSavingDenue(false);
    if (res?.ok) {
      setMessage({ ok: true, text: "DENUE guardado. Prueba la conexión para confirmar." });
      setDenueToken("");
      await refresh();
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setMessage({ ok: false, text: data?.error?.message ?? "No se pudo guardar DENUE." });
    }
  }

  async function handleTestDenue() {
    setTestingDenue(true);
    setMessage(null);
    const res = await fetch("/api/settings/intel/denue/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ denueToken }),
    }).catch(() => null);
    setTestingDenue(false);
    if (res?.ok) {
      setMessage({ ok: true, text: "DENUE responde correctamente." });
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setMessage({ ok: false, text: data?.error?.message ?? "DENUE no respondió." });
    }
    await refresh();
  }

  /* ── Google Trends ────────────────────────────────────────────────────── */

  async function handleSaveGt() {
    setSavingGt(true);
    setMessage(null);
    const res = await fetch("/api/settings/intel", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        youtubeKey: `····${connection?.youtubeKeyLast4}`,
        denueToken: connection?.denueConfigured ? undefined : null,
        gtEnabled,
      }),
    }).catch(() => null);
    setSavingGt(false);
    if (res?.ok) {
      setMessage({ ok: true, text: "Google Trends actualizado." });
      await refresh();
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setMessage({ ok: false, text: data?.error?.message ?? "No se pudo actualizar Google Trends." });
    }
  }

  async function handleTestGt() {
    setTestingGt(true);
    setMessage(null);
    const res = await fetch("/api/settings/intel/gt/test", { method: "POST" }).catch(() => null);
    setTestingGt(false);
    if (res?.ok) {
      setMessage({ ok: true, text: "Google Trends responde correctamente." });
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setMessage({ ok: false, text: data?.error?.message ?? "Google Trends no respondió." });
    }
    await refresh();
  }

  /* ── Borrar todo ──────────────────────────────────────────────────────── */

  async function handleDisconnect() {
    await fetch("/api/settings/intel", { method: "DELETE" }).catch(() => null);
    setConnection(null);
    setGtEnabled(false);
    setMessage({ ok: true, text: "Credenciales eliminadas." });
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Inteligencia de Mercado</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-2">
          Conecta las fuentes gratuitas del módulo. Cada una se prueba en vivo: el badge
          verde significa «Conectado» (probado hoy), el rojo «Error» o «No configurado».
          Los secretos se guardan cifrados y solo se muestra su último fragmento.
        </p>
      </header>

      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`flex items-start gap-2 rounded-md border p-3 text-sm ${message.ok ? "border-success-soft bg-success-tint text-success-text" : "border-danger-soft bg-danger-tint text-danger-text"}`}
        >
          {message.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          {message.text}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-text-2">Consultando estado de conexiones…</p>
      ) : (
        <>
          {/* ── Tarjeta YouTube ─────────────────────────────────────────── */}
          <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Conexión YouTube">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold">
                <Video className="h-4 w-4 text-brand-text" /> YouTube Data API
              </h2>
              <StatusBadge status={connection?.youtubeStatus ?? null} saved={Boolean(connection?.youtubeKeyLast4)} />
            </div>
            <p className="mt-1 text-xs text-text-3">
              Feed popular de México · gratis en console.cloud.google.com · {connection?.youtubeKeyLast4 ? `····${connection.youtubeKeyLast4}` : "sin key"}
              {connection?.youtubeLastTestAt && ` · último test ${new Date(connection.youtubeLastTestAt).toLocaleString("es-MX")}`}
            </p>
            <form onSubmit={(e) => void handleSaveYoutube(e)} className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Label htmlFor="yt-key">API key {connection?.youtubeKeyLast4 ? "(dejar en blanco para mantener)" : ""}</Label>
                <Input
                  id="yt-key"
                  type="password"
                  value={youtubeKey}
                  onChange={(e) => setYoutubeKey(e.target.value)}
                  required={!connection?.youtubeKeyLast4}
                  placeholder="AIza…"
                />
              </div>
              <Button type="submit" disabled={savingYoutube}>
                <Save className="mr-1 h-4 w-4" /> {savingYoutube ? "Guardando…" : "Guardar"}
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleTestYoutube()} disabled={testingYoutube}>
                <Search className={`mr-1 h-4 w-4 ${testingYoutube ? "animate-pulse" : ""}`} />
                {testingYoutube ? "Probando…" : "Probar conexión"}
              </Button>
            </form>
          </section>

          {/* ── Tarjeta DENUE ───────────────────────────────────────────── */}
          <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Conexión DENUE">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold">
                <Plug className="h-4 w-4 text-brand-text" /> DENUE · INEGI
              </h2>
              <StatusBadge status={connection?.denueStatus ?? null} saved={connection?.denueConfigured ?? false} />
            </div>
            <p className="mt-1 text-xs text-text-3">
              Directorio de establecimientos · gratis por correo en inegi.org.mx
              {connection?.denueLastTestAt && ` · último test ${new Date(connection.denueLastTestAt).toLocaleString("es-MX")}`}
            </p>
            <form onSubmit={(e) => void handleSaveDenue(e)} className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Label htmlFor="denue-token">Token DENUE {connection?.denueConfigured ? "(dejar en blanco para mantener)" : "(opcional)"}</Label>
                <Input
                  id="denue-token"
                  type="password"
                  value={denueToken}
                  onChange={(e) => setDenueToken(e.target.value)}
                  required={!connection?.denueConfigured}
                  placeholder="Token de 32 caracteres"
                />
              </div>
              <Button type="submit" disabled={savingDenue}>
                <Save className="mr-1 h-4 w-4" /> {savingDenue ? "Guardando…" : "Guardar"}
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleTestDenue()} disabled={testingDenue || !denueToken}>
                <Search className={`mr-1 h-4 w-4 ${testingDenue ? "animate-pulse" : ""}`} />
                {testingDenue ? "Probando…" : "Probar conexión"}
              </Button>
            </form>
          </section>

          {/* ── Tarjeta Google Trends ───────────────────────────────────── */}
          <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Conexión Google Trends">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold">
                <TrendingUp className="h-4 w-4 text-brand-text" /> Google Trends
              </h2>
              <StatusBadge status={connection?.gtStatus ?? null} saved={connection?.gtEnabled ?? false} />
            </div>
            <p className="mt-1 text-xs text-text-3">
              Endpoint no oficial (sin API key, gratis) · sujeto a cambios de Google ·{" "}
              {connection?.gtLastTestAt
                ? `último test ${new Date(connection.gtLastTestAt).toLocaleString("es-MX")}`
                : "sin prueba"}
              {connection?.gtLastSyncAt && ` · última sync ${new Date(connection.gtLastSyncAt).toLocaleString("es-MX")}`}
            </p>
            <p className="mt-2 text-xs text-text-3">
              La serie GT (índice 0–100) es la fuente principal de Inteligencia; sin ella,
              el módulo usa YouTube como fallback normalizado.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={gtEnabled}
                  onChange={(e) => setGtEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Habilitar Google Trends
              </label>
              <Button type="button" onClick={() => void handleSaveGt()} disabled={savingGt}>
                <Save className="mr-1 h-4 w-4" /> {savingGt ? "Guardando…" : "Guardar"}
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleTestGt()} disabled={testingGt}>
                <Search className={`mr-1 h-4 w-4 ${testingGt ? "animate-pulse" : ""}`} />
                {testingGt ? "Probando…" : "Probar conexión"}
              </Button>
            </div>
          </section>

          {/* ── Acciones globales ───────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void refresh()} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" /> Actualizar estado
            </Button>
            <Button onClick={() => void handleDisconnect()} variant="ghost" className="text-danger-text">
              <Trash2 className="mr-2 h-4 w-4" /> Eliminar todas las credenciales
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
