"use client";

import { useCallback, useEffect, useState } from "react";
import { Plug, RefreshCw, Save, Star, Trash2, XCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Connection = {
  status: "connected" | "error";
  clientId: string;
  clientSecretLast4: string;
  refreshTokenSet: boolean;
  lastSyncedAt: string | null;
} | null;

type LocationRow = {
  id: string;
  name: string;
  displayName: string | null;
  averageRating: string | null;
  reviewCount: number;
};

type ReviewRow = {
  id: string;
  locationId: string;
  reviewerName: string | null;
  rating: number;
  comment: string | null;
  createTime: string;
  replyComment: string | null;
  repliedAt: string | null;
};

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`}
        />
      ))}
    </span>
  );
}

export function GoogleBusinessClient() {
  const [connection, setConnection] = useState<Connection>(null);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);

  const refresh = useCallback(async () => {
    const [connRes, locRes] = await Promise.all([
      fetch("/api/settings/google-business", { cache: "no-store" }).catch(() => null),
      fetch("/api/settings/google-business/locations", { cache: "no-store" }).catch(() => null),
    ]);
    if (connRes?.ok) {
      const data = await connRes.json().catch(() => null) as { connection: Connection } | null;
      setConnection(data?.connection ?? null);
      if (data?.connection) setClientId(data.connection.clientId);
    }
    if (locRes?.ok) {
      const data = await locRes.json().catch(() => null) as { locations: LocationRow[]; reviews: ReviewRow[] } | null;
      setLocations(data?.locations ?? []);
      setReviews(data?.reviews ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/settings/google-business", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret, refreshToken }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      setMessage({ ok: true, text: "Conectado. Tus reseñas aparecerán en la Bandeja." });
      setClientSecret("");
      setRefreshToken("");
      await refresh();
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setMessage({ ok: false, text: data?.error?.message ?? "Google rechazó las credenciales." });
    }
  }

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    const res = await fetch("/api/settings/google-business/sync", { method: "POST" }).catch(() => null);
    setSyncing(false);
    if (res?.ok) {
      const data = await res.json().catch(() => null) as { locations: number; reviews: number; newReviews: number } | null;
      setMessage({
        ok: true,
        text: `Sync completa: ${data?.locations ?? 0} local(es), ${data?.reviews ?? 0} reseña(s), ${data?.newReviews ?? 0} nueva(s).`,
      });
      await refresh();
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setMessage({ ok: false, text: data?.error?.message ?? "No se pudo sincronizar." });
    }
  }

  async function handleDisconnect() {
    await fetch("/api/settings/google-business", { method: "DELETE" }).catch(() => null);
    setConnection(null);
    setMessage({ ok: true, text: "Conexión eliminada." });
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Google Business</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-2">
          Las reseñas de tu Perfil de Empresa en Google llegan como conversaciones en la
          Bandeja. Responder desde el compositor publica tu respuesta como reply público
          del negocio (hasta 4096 caracteres, sin ventana de 24 h).
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
          <Plug className="h-4 w-4 text-brand-text" /> Conexión
          {connection && (
            <span className={`ml-auto text-xs font-medium ${connection.status === "connected" ? "text-success" : "text-warning-text"}`}>
              {connection.status === "connected" ? "Conectada" : "Con error — vuelve a conectar"}
            </span>
          )}
        </h2>
        {loading ? (
          <p className="mt-3 text-sm text-text-2">Consultando…</p>
        ) : connection ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-text-2">
              Cliente OAuth <code className="font-mono">{connection.clientId}</code>
              {" · "}secret ····{connection.clientSecretLast4}
              {connection.lastSyncedAt && (
                <>{" · "}última sync {new Date(connection.lastSyncedAt).toLocaleString("es-MX")}</>
              )}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void handleSync()} disabled={syncing} variant="outline">
                <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Sincronizando…" : "Sincronizar reseñas ahora"}
              </Button>
              <Button onClick={() => void handleDisconnect()} variant="ghost" className="text-danger-text">
                <Trash2 className="mr-2 h-4 w-4" /> Desconectar
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleConnect(e)} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Client ID (OAuth)</Label>
                <Input value={clientId} onChange={(e) => setClientId(e.target.value)} required placeholder="…apps.googleusercontent.com" />
              </div>
              <div>
                <Label>Client Secret</Label>
                <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} required placeholder="GOCSPX-…" />
              </div>
              <div className="sm:col-span-2">
                <Label>Refresh Token (scope business.manage)</Label>
                <Input type="password" value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} required placeholder="1//0g…" />
                <p className="mt-1 text-[11px] leading-snug text-text-3">
                  Autoriza una vez en <code>developers.google.com/oauthplayground</code> con el
                  alcance <code>https://www.googleapis.com/auth/business.manage</code> y pega el
                  token. Al conectar, el CRM verifica contra Google antes de guardar.
                </p>
              </div>
            </div>
            <Button type="submit" disabled={saving}>
              <Save className="mr-2 h-4 w-4" /> {saving ? "Verificando…" : "Conectar"}
            </Button>
          </form>
        )}
      </section>

      {locations.length > 0 && (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">Locales</h2>
          <ul className="mt-3 space-y-2">
            {locations.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{l.displayName ?? l.name}</span>
                {l.averageRating && <Stars rating={Math.round(Number(l.averageRating))} />}
                <span className="text-text-3">{l.reviewCount} reseña(s)</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">Reseñas recientes</h2>
          <ul className="mt-3 space-y-3">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{r.reviewerName ?? "Reseña anónima"}</span>
                  <Stars rating={r.rating} />
                  <span className="text-xs text-text-3">{new Date(r.createTime).toLocaleDateString("es-MX")}</span>
                  {r.repliedAt && <span className="ml-auto text-xs text-success">Respondida</span>}
                </div>
                {r.comment && <p className="mt-1 text-sm text-text-2">{r.comment}</p>}
                {r.replyComment && (
                  <p className="mt-2 rounded-md bg-subtle p-2 text-sm text-text-2">
                    <span className="text-xs font-semibold text-text-3">Tu respuesta (pública): </span>
                    {r.replyComment}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
