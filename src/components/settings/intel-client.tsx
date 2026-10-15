"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Globe,
  MapPin,
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
  youtubeConfigured: boolean;
  youtubeKeyLast4: string | null;
  youtubeStatus: "ok" | "error" | null;
  youtubeLastTestAt: string | null;
  denueConfigured: boolean;
  denueStatus: "ok" | "error" | null;
  denueLastTestAt: string | null;
  serpapiConfigured: boolean;
  serpapiKeyLast4: string | null;
  serpapiStatus: "ok" | "error" | null;
  serpapiLastTestAt: string | null;
  serpapiLastSyncAt: string | null;
  serpapiQueriesUsed: number;
  apifyConfigured: boolean;
  apifyTokenLast4: string | null;
  apifyActorId: string | null;
  apifyStatus: "ok" | "error" | null;
  apifyLastTestAt: string | null;
  apifyLastSyncAt: string | null;
  apifyQueriesUsed: number;
  gtEnabled: boolean;
  gtStatus: "ok" | "error" | null;
  gtLastTestAt: string | null;
  gtLastSyncAt: string | null;
  lastIngestAt: string | null;
  status: "connected" | "error";
} | null;

type SourceStatus = "ok" | "error" | null;

/* ── Badge de estado ─────────────────────────────────────────────────────── */

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
 * Credenciales del módulo de inteligencia: tarjetas INDIVIDUALES por
 * proveedor (SerpApi, Apify, DENUE/INEGI, YouTube). Cada una se guarda
 * y prueba de forma independiente; no se exige YouTube para las demás.
 */
export function IntelSettingsClient() {
  const [connection, setConnection] = useState<Connection>(null);
  const [loading, setLoading] = useState(true);

  // SerpApi
  const [serpapiKey, setSerpapiKey] = useState("");
  const [savingSerpapi, setSavingSerpapi] = useState(false);
  const [testingSerpapi, setTestingSerpapi] = useState(false);

  // Apify
  const [apifyToken, setApifyToken] = useState("");
  const [apifyActorId, setApifyActorId] = useState("");
  const [savingApify, setSavingApify] = useState(false);
  const [testingApify, setTestingApify] = useState(false);

  // DENUE
  const [denueToken, setDenueToken] = useState("");
  const [denueKeyword, setDenueKeyword] = useState("");
  const [savingDenue, setSavingDenue] = useState(false);
  const [testingDenue, setTestingDenue] = useState(false);

  // YouTube
  const [youtubeKey, setYoutubeKey] = useState("");
  const [savingYoutube, setSavingYoutube] = useState(false);
  const [testingYoutube, setTestingYoutube] = useState(false);

  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/settings/intel", { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => null) as { connection: Connection } | null;
      setConnection(data?.connection ?? null);
      if (data?.connection) {
        setApifyActorId(data.connection.apifyActorId ?? "");
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function save(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch("/api/settings/intel", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res?.ok) return true;
    const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
    setMessage({ ok: false, text: data?.error?.message ?? "No se pudo guardar." });
    return false;
  }

  /* ── SerpApi ────────────────────────────────────────────────────────────── */

  async function handleSaveSerpapi(e: React.FormEvent) {
    e.preventDefault();
    setSavingSerpapi(true);
    setMessage(null);
    const ok = await save({ serpapiKey });
    setSavingSerpapi(false);
    if (ok) {
      setMessage({ ok: true, text: "SerpApi guardado. Prueba la conexión para confirmar." });
      setSerpapiKey("");
      await refresh();
    }
  }

  async function handleTestSerpapi() {
    setTestingSerpapi(true);
    setMessage(null);
    const res = await fetch("/api/settings/intel/serpapi/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serpapiKey: serpapiKey || `····${connection?.serpapiKeyLast4}` }),
    }).catch(() => null);
    setTestingSerpapi(false);
    if (res?.ok) {
      setMessage({ ok: true, text: "SerpApi responde correctamente." });
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setMessage({ ok: false, text: data?.error?.message ?? "SerpApi no respondió." });
    }
    await refresh();
  }

  /* ── Apify ──────────────────────────────────────────────────────────────── */

  async function handleSaveApify(e: React.FormEvent) {
    e.preventDefault();
    setSavingApify(true);
    setMessage(null);
    const body: Record<string, unknown> = {};
    if (apifyToken) body.apifyToken = apifyToken;
    if (apifyActorId) body.apifyActorId = apifyActorId;
    const ok = await save(body);
    setSavingApify(false);
    if (ok) {
      setMessage({ ok: true, text: "Apify guardado. Prueba la conexión para confirmar." });
      setApifyToken("");
      await refresh();
    }
  }

  async function handleTestApify() {
    setTestingApify(true);
    setMessage(null);
    const res = await fetch("/api/settings/intel/apify/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apifyToken: apifyToken || `····${connection?.apifyTokenLast4}`,
        apifyActorId,
      }),
    }).catch(() => null);
    setTestingApify(false);
    if (res?.ok) {
      setMessage({ ok: true, text: "Apify responde correctamente." });
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setMessage({ ok: false, text: data?.error?.message ?? "Apify no respondió." });
    }
    await refresh();
  }

  /* ── DENUE ──────────────────────────────────────────────────────────────── */

  async function handleSaveDenue(e: React.FormEvent) {
    e.preventDefault();
    setSavingDenue(true);
    setMessage(null);
    const ok = await save({ denueToken });
    setSavingDenue(false);
    if (ok) {
      setMessage({ ok: true, text: "DENUE guardado. Prueba la conexión para confirmar." });
      setDenueToken("");
      await refresh();
    }
  }

  async function handleTestDenue() {
    setTestingDenue(true);
    setMessage(null);
    const res = await fetch("/api/settings/intel/denue/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // Campo vacío = probar el token guardado (el endpoint lo resuelve).
        denueToken: denueToken || "····",
        keyword: denueKeyword || undefined,
      }),
    }).catch(() => null);
    setTestingDenue(false);
    if (res?.ok) {
      const data = await res?.json().catch(() => null) as { count?: number; censored?: boolean; keyword?: string } | null;
      const countText = data ? ` (${data.count} establecimientos${data.censored ? " o más" : ""})` : "";
      setMessage({ ok: true, text: `DENUE responde correctamente${countText}.` });
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setMessage({ ok: false, text: data?.error?.message ?? "DENUE no respondió." });
    }
    await refresh();
  }

  /* ── YouTube ────────────────────────────────────────────────────────────── */

  async function handleSaveYoutube(e: React.FormEvent) {
    e.preventDefault();
    setSavingYoutube(true);
    setMessage(null);
    const ok = await save({ youtubeKey });
    setSavingYoutube(false);
    if (ok) {
      setMessage({ ok: true, text: "YouTube guardado. Prueba la conexión para confirmar." });
      setYoutubeKey("");
      await refresh();
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

  /* ── Borrar todo ────────────────────────────────────────────────────────── */

  async function handleDisconnect() {
    await fetch("/api/settings/intel", { method: "DELETE" }).catch(() => null);
    setConnection(null);
    setApifyActorId("");
    setMessage({ ok: true, text: "Credenciales eliminadas." });
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Inteligencia de Mercado</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-2">
          Conecta las fuentes del módulo. Cada proveedor se configura y prueba de forma
          independiente. Los secretos se guardan cifrados y solo se muestra su último fragmento.
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
          {/* ── Tarjeta SerpApi (principal) ──────────────────────────────── */}
          <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Conexión SerpApi">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold">
                <TrendingUp className="h-4 w-4 text-brand-text" /> Google Trends · SerpApi
                <Badge variant="outline" className="ml-1 text-[10px]">Principal</Badge>
              </h2>
              <StatusBadge status={connection?.serpapiStatus ?? null} saved={connection?.serpapiConfigured ?? false} />
            </div>
            <p className="mt-1 text-xs text-text-3">
              API estructurada de Google Trends · 250 búsquedas gratis/mes · serpapi.com
              {connection?.serpapiKeyLast4 && ` · ····${connection.serpapiKeyLast4}`}
              {connection?.serpapiLastTestAt && ` · último test ${new Date(connection.serpapiLastTestAt).toLocaleString("es-MX")}`}
              {connection?.serpapiLastSyncAt && ` · última sync ${new Date(connection.serpapiLastSyncAt).toLocaleString("es-MX")}`}
              {connection?.serpapiQueriesUsed !== undefined && ` · ${connection.serpapiQueriesUsed}/250 consultas`}
            </p>
            <form onSubmit={(e) => void handleSaveSerpapi(e)} className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Label htmlFor="serpapi-key">API key {connection?.serpapiConfigured ? "(dejar en blanco para mantener)" : ""}</Label>
                <Input
                  id="serpapi-key"
                  type="password"
                  value={serpapiKey}
                  onChange={(e) => setSerpapiKey(e.target.value)}
                  required={!connection?.serpapiConfigured}
                  placeholder="API key de SerpApi"
                />
              </div>
              <Button type="submit" disabled={savingSerpapi}>
                <Save className="mr-1 h-4 w-4" /> {savingSerpapi ? "Guardando…" : "Guardar"}
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleTestSerpapi()} disabled={testingSerpapi}>
                <Search className={`mr-1 h-4 w-4 ${testingSerpapi ? "animate-pulse" : ""}`} />
                {testingSerpapi ? "Probando…" : "Probar conexión"}
              </Button>
            </form>
          </section>

          {/* ── Tarjeta Apify (respaldo) ─────────────────────────────────── */}
          <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Conexión Apify">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold">
                <Globe className="h-4 w-4 text-brand-text" /> Google Trends · Apify
                <Badge variant="outline" className="ml-1 text-[10px]">Respaldo</Badge>
              </h2>
              <StatusBadge status={connection?.apifyStatus ?? null} saved={connection?.apifyConfigured ?? false} />
            </div>
            <p className="mt-1 text-xs text-text-3">
              Scraper de Google Trends vía plataforma Apify · se activa solo si SerpApi falla
              {connection?.apifyTokenLast4 && ` · ····${connection.apifyTokenLast4}`}
              {connection?.apifyLastTestAt && ` · último test ${new Date(connection.apifyLastTestAt).toLocaleString("es-MX")}`}
              {connection?.apifyLastSyncAt && ` · última sync ${new Date(connection.apifyLastSyncAt).toLocaleString("es-MX")}`}
            </p>
            <form onSubmit={(e) => void handleSaveApify(e)} className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Label htmlFor="apify-token">API token {connection?.apifyConfigured ? "(dejar en blanco para mantener)" : ""}</Label>
                <Input
                  id="apify-token"
                  type="password"
                  value={apifyToken}
                  onChange={(e) => setApifyToken(e.target.value)}
                  required={!connection?.apifyConfigured}
                  placeholder="Token de Apify"
                />
              </div>
              <div className="min-w-0 flex-1">
                <Label htmlFor="apify-actor">Actor ID de Google Trends</Label>
                <Input
                  id="apify-actor"
                  type="text"
                  value={apifyActorId}
                  onChange={(e) => setApifyActorId(e.target.value)}
                  placeholder="Ej: nwua9Gu5YrADL7ZDj"
                />
              </div>
              <Button type="submit" disabled={savingApify}>
                <Save className="mr-1 h-4 w-4" /> {savingApify ? "Guardando…" : "Guardar"}
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleTestApify()} disabled={testingApify || !apifyActorId}>
                <Search className={`mr-1 h-4 w-4 ${testingApify ? "animate-pulse" : ""}`} />
                {testingApify ? "Probando…" : "Probar conexión"}
              </Button>
            </form>
          </section>

          {/* ── Tarjeta DENUE ────────────────────────────────────────────── */}
          <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Conexión DENUE">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold">
                <MapPin className="h-4 w-4 text-brand-text" /> INEGI · DENUE
                <Badge variant="outline" className="ml-1 text-[10px]">Competencia local</Badge>
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
            </form>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Label htmlFor="denue-keyword">Keyword para prueba</Label>
                <Input
                  id="denue-keyword"
                  type="text"
                  value={denueKeyword}
                  onChange={(e) => setDenueKeyword(e.target.value)}
                  placeholder="Ej: cámaras de seguridad"
                />
              </div>
              <Button type="button" variant="outline" onClick={() => void handleTestDenue()} disabled={testingDenue}>
                <Search className={`mr-1 h-4 w-4 ${testingDenue ? "animate-pulse" : ""}`} />
                {testingDenue ? "Probando…" : "Probar conexión"}
              </Button>
            </div>
          </section>

          {/* ── Tarjeta YouTube (opcional) ───────────────────────────────── */}
          <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Conexión YouTube">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold">
                <Video className="h-4 w-4 text-brand-text" /> YouTube Data API
                <Badge variant="outline" className="ml-1 text-[10px] text-text-3">Opcional</Badge>
              </h2>
              <StatusBadge status={connection?.youtubeStatus ?? null} saved={connection?.youtubeConfigured ?? false} />
            </div>
            <p className="mt-1 text-xs text-text-3">
              Feed popular de México · gratis en console.cloud.google.com
              {connection?.youtubeKeyLast4 && ` · ····${connection.youtubeKeyLast4}`}
              {connection?.youtubeLastTestAt && ` · último test ${new Date(connection.youtubeLastTestAt).toLocaleString("es-MX")}`}
            </p>
            <form onSubmit={(e) => void handleSaveYoutube(e)} className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <Label htmlFor="yt-key">API key {connection?.youtubeConfigured ? "(dejar en blanco para mantener)" : "(opcional)"}</Label>
                <Input
                  id="yt-key"
                  type="password"
                  value={youtubeKey}
                  onChange={(e) => setYoutubeKey(e.target.value)}
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

          {/* ── Acciones globales ────────────────────────────────────────── */}
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
