"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 015 · B2 — El calendario Google de QUIEN mira la pantalla.
 *
 * Es la mitad personal de la conexión. Las citas del negocio siguen agendándose
 * contra el calendario de la empresa (tarjeta de arriba, solo del dueño); aquí
 * cada persona enlaza el SUYO para ver sus Pendientes y tareas de proyecto con
 * fecha. Esa separación es la que decide dónde escribe cada flujo, así que la
 * tarjeta no ofrece ni campos de cliente ni calendarId del negocio: solo el
 * consentimiento propio.
 *
 * Un miembro NO puede pegar credenciales aquí a propósito: las credenciales de
 * la app OAuth (Client ID/Secret) son del negocio —un proyecto de Google Cloud
 * por instancia— y lo personal es el consentimiento. El botón reutiliza la app
 * del negocio y Google pide autorización a la cuenta que cada uno elija.
 */

const API = "/api/settings/google/personal";

type Personal = {
  connection: { status: "connected" | "error"; calendarId: string } | null;
  syncTasks: boolean;
  businessConnected: boolean;
};

export function PersonalCalendar() {
  const [data, setData] = useState<Personal | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [calendarId, setCalendarId] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    const res = await fetch(API).catch(() => null);
    const payload = res?.ok
      ? ((await res.json().catch(() => null)) as Personal | null)
      : null;
    setBusy(false);
    if (!payload) {
      // Igual que en las credenciales del negocio: una lectura que falla no es
      // «no tienes calendario conectado», y pintarla así invita a reconectar
      // encima de una conexión que sí funciona.
      setLoadFailed(true);
      setData(null);
      return;
    }
    setLoadFailed(false);
    setData(payload);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function connectWithGoogle() {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`${API}/oauth/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ calendarId: calendarId.trim() || undefined }),
    }).catch(() => null);
    const payload = (await res?.json().catch(() => null)) as
      | { url?: string; error?: { message?: string } }
      | null;
    if (!res?.ok || !payload?.url) {
      setBusy(false);
      setMessage({
        kind: "error",
        text:
          payload?.error?.message ??
          "No se pudo abrir la autorización de Google. Inténtalo de nuevo.",
      });
      return;
    }
    window.location.assign(payload.url);
  }

  async function toggleSync(next: boolean) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(API, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ syncTasks: next }),
    }).catch(() => null);
    const payload = (await res?.json().catch(() => null)) as
      | { backfilled?: { synced: number; failed: number }; error?: { message?: string } }
      | null;
    setBusy(false);
    if (!res?.ok) {
      setMessage({
        kind: "error",
        text:
          payload?.error?.message ??
          "No se pudo cambiar la sincronización de tus tareas.",
      });
      return;
    }
    setData((d) => (d ? { ...d, syncTasks: next } : d));
    const synced = next ? (payload?.backfilled?.synced ?? 0) : 0;
    const failed = next ? (payload?.backfilled?.failed ?? 0) : 0;
    if (failed > 0) {
      setMessage({
        kind: "error",
        text: `${failed} tarea(s) tuya(s) no se pudieron enviar a Google. Repite la conexión si el problema persiste.`,
      });
      return;
    }
    setMessage({
      kind: "ok",
      text: !next
        ? "Sincronización apagada"
        : synced > 0
          ? `Sincronización encendida — ${synced} tarea(s) en tu calendario`
          : "Sincronización encendida",
    });
  }

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    const res = await fetch(API, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setMessage({ kind: "error", text: "No se pudo desconectar tu calendario." });
      return;
    }
    setData((d) => (d ? { ...d, connection: null, syncTasks: false } : d));
    setMessage({ kind: "ok", text: "Calendario personal desconectado" });
  }

  const connection = data?.connection ?? null;
  const needsBusiness = data !== null && !data.businessConnected;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mi calendario</CardTitle>
        <CardDescription>
          Tus Pendientes y tus tareas de proyecto con fecha, en tu Google Calendar
          personal. Las citas que reservan los clientes siguen yendo al calendario
          de la empresa.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadFailed && (
          <p className="rounded-sm border border-warning-soft bg-warning-tint px-3 py-2 text-sm text-warning-text">
            No se pudo leer tu conexión. Que aparezca sin conectar no significa que
            falten credenciales: la lectura falló.
            {" "}
            <button
              type="button"
              className="font-medium underline"
              onClick={() => void reload()}
            >
              Reintentar
            </button>
          </p>
        )}

        {connection?.status === "error" && (
          <p className="rounded-sm border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
            Google rechazó tu autorización. Tus tareas siguen guardadas en el CRM,
            pero dejan de crear eventos hasta que vuelvas a conectar.
          </p>
        )}

        {needsBusiness && !connection && (
          <p className="rounded-sm border border-border px-3 py-2 text-sm text-text-2">
            Todavía no se puede conectar un calendario personal: la empresa aún no
            tiene Google Calendar conectado. Pídele a quien administra la cuenta que
            lo enlace arriba y vuelve aquí.
          </p>
        )}

        {!connection && !needsBusiness && !loadFailed && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="personal-calendarId">Calendario</Label>
              <Input
                id="personal-calendarId"
                value={calendarId}
                placeholder="primary"
                onChange={(e) => setCalendarId(e.target.value)}
                disabled={busy}
              />
              <p className="text-xs text-text-3">
                Déjalo vacío o en «primary» para tu calendario principal. Aquí sí se
                aplica a TU calendario, no al de la empresa.
              </p>
            </div>
            <Button onClick={() => void connectWithGoogle()} disabled={busy}>
              {busy ? "Abriendo Google…" : "Conectar mi calendario"}
            </Button>
          </div>
        )}

        {connection && (
          <div className="space-y-3">
            <p className="text-sm">
              Conectado a{" "}
              <span className="font-semibold">
                {connection.calendarId === "primary" ? "tu calendario principal" : connection.calendarId}
              </span>
              . En Google verás la app de la empresa como nombre de la autorización:
              es su proyecto de Google Cloud, no una app tuya.
            </p>

            <div className="space-y-1.5 rounded-sm border border-border px-3 py-2.5">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={Boolean(data?.syncTasks)}
                  disabled={busy || connection.status === "error"}
                  onChange={(e) => void toggleSync(e.target.checked)}
                />
                Sincronizar mis Pendientes y tareas de proyecto
              </label>
              <p className="text-xs text-text-3">
                Solo tus tareas: cada una con fecha se crea como evento en tu
                calendario y editarla mueve ese mismo evento. Google avisa 30 minutos
                antes; las fechas límite de proyecto, a las 9:00 del día. Apagarlo no
                borra los eventos ya creados.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => void connectWithGoogle()} disabled={busy}>
                {connection.status === "error" ? "Volver a conectar" : "Cambiar de calendario"}
              </Button>
              <button
                type="button"
                onClick={() => void disconnect()}
                disabled={busy}
                className="text-sm text-text-3 hover:text-foreground"
              >
                Desconectar
              </button>
            </div>
          </div>
        )}

        {message && (
          <p
            className={
              message.kind === "ok"
                ? "text-sm text-brand-text"
                : "text-sm text-destructive"
            }
          >
            {message.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
