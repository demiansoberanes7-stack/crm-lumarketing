"use client";

import { useEffect, useState } from "react";
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
import { CONNECTOR_META, type ConnectorId } from "@/lib/agenda-connectors";

/**
 * 015 — Las credenciales de un conector externo.
 *
 * Se guardan por su cuenta, no con el botón de la pantalla: primero se validan
 * CONTRA EL PROVEEDOR y solo entonces tocan la base. Unas credenciales que no
 * sirven no llegan a guardarse — el mismo trato que el wizard de WhatsApp.
 *
 * Hacia fuera nunca vuelve un secreto: solo sus últimos 4 y el estado.
 */

type ExternalConnector = Exclude<ConnectorId, "enlace-fijo">;

type Field = {
  name: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  help?: string;
};

const FIELDS: Record<ExternalConnector, Field[]> = {
  zoom: [
    { name: "accountId", label: "Account ID", placeholder: "abc123..." },
    { name: "clientId", label: "Client ID" },
    { name: "clientSecret", label: "Client Secret", secret: true },
  ],
  google: [
    { name: "clientId", label: "Client ID", placeholder: "…apps.googleusercontent.com" },
    { name: "clientSecret", label: "Client Secret", secret: true },
    {
      name: "refreshToken",
      label: "Refresh token",
      secret: true,
      help: "Lo entrega el botón «Autorizar con Google»; puedes pegarlo a mano solo si ya lo tienes.",
    },
    {
      name: "calendarId",
      label: "Calendario",
      placeholder: "primary",
      help: "Déjalo en «primary» para tu calendario principal.",
    },
  ],
};

/** Lo que hay que saber ANTES de pegar nada. Son los tropiezos reales. */
const HELP: Record<ExternalConnector, { title: string; items: string[] }> = {
  zoom: {
    title: "Crea una app Server-to-Server OAuth en el Marketplace de Zoom",
    items: [
      "Copia de ahí el Account ID, el Client ID y el Client Secret.",
      "Dale los cuatro permisos: crear, actualizar y borrar reunión, y leer el usuario (meeting:write, meeting:update, meeting:delete y user:read).",
      "El de leer usuario es el que usa el botón «Probar»: sin él la conexión falla aunque las credenciales sean correctas.",
    ],
  },
  google: {
    title: "Crea un proyecto en Google Cloud con la API de Calendar activada",
    items: [
      "Necesitas Client ID y Client Secret; el refresh token lo obtiene el propio CRM al autorizar, sin copiar ni pegar nada.",
      "Registra la URI de redirección de abajo como «URI de redirección autorizada» en la pantalla de credenciales OAuth.",
      "IMPORTANTE: publica tu app OAuth «en producción». Si la dejas en modo prueba, Google revoca el permiso a los 7 días y las citas dejarán de crear su enlace sin previo aviso.",
    ],
  },
};

/** Motivos de vuelta del callback → lo que le hace falta entender al dueño. */
const OAUTH_ERRORS: Record<string, string> = {
  state_invalid:
    "El enlace de conexión caducó o ya se usó. Vuelve a iniciar la conexión.",
  missing_code: "Google no devolvió el código de autorización.",
  exchange_failed: "No se pudo canjear el código por una credencial.",
  access_denied: "Cancelaste la autorización en Google.",
  invalid_client: "El Client ID o el Client Secret no son válidos.",
  invalid_grant: "El código caducó o la app sigue en modo prueba; repite la conexión.",
  redirect_uri_mismatch:
    "La URI de redirección no coincide con la registrada en Google Cloud.",
};

type Connection = {
  status: "connected" | "error";
  secretLast4: string | null;
  fields: Record<string, string>;
};

export function ConnectorCredentials({
  connector,
}: {
  connector: ExternalConnector;
}) {
  const meta = CONNECTOR_META[connector];
  const fields = FIELDS[connector];
  const help = HELP[connector];

  const [connection, setConnection] = useState<Connection | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [syncTasks, setSyncTasks] = useState(false);
  const [redirectUri, setRedirectUri] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    setConnection(null);
    setValues({});
    setMessage(null);
    setSyncTasks(false);
    void (async () => {
      const res = await fetch(`/api/settings/${connector}`).catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json()) as {
        connection: Connection | null;
        syncTasks?: boolean;
        redirectUri?: string;
      };
      setConnection(data.connection);
      setSyncTasks(Boolean(data.syncTasks));
      setRedirectUri(data.redirectUri ?? null);
      if (data.connection) setValues({ ...data.connection.fields });
    })();
  }, [connector]);

  /**
   * Resultado del vuelco OAuth (Google redirige aquí). Se lee del historial y
   * no con `useSearchParams` para no exigir un <Suspense> en toda la página.
   */
  useEffect(() => {
    if (connector !== "google") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) {
      setMessage({ kind: "ok", text: "Google conectado" });
    } else if (error) {
      setMessage({ kind: "error", text: OAUTH_ERRORS[error] ?? error });
    }
    if (connected || error) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [connector]);

  /** Abre el consentimiento de Google; vuelve aquí con el refresh token. */
  async function connectWithGoogle() {
    if (!values.clientId?.trim() || !values.clientSecret?.trim()) {
      setMessage({
        kind: "error",
        text: "Escribe primero el Client ID y el Client Secret de tu proyecto de Google Cloud.",
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/settings/${connector}/oauth/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: values.clientId,
        clientSecret: values.clientSecret,
        calendarId: values.calendarId,
      }),
    }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setMessage({
        kind: "error",
        text: data?.error?.message ?? "No se pudo abrir la autorización de Google.",
      });
      return;
    }
    const data = (await res.json()) as { url: string };
    window.location.assign(data.url);
  }

  async function submit(mode: "test" | "save") {
    setBusy(true);
    setMessage(null);
    const url =
      mode === "test"
        ? `/api/settings/${connector}/test`
        : `/api/settings/${connector}`;
    const res = await fetch(url, {
      method: mode === "test" ? "POST" : "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    }).catch(() => null);
    setBusy(false);

    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setMessage({
        kind: "error",
        text:
          data?.error?.message ??
          `No se pudo conectar con ${meta.label}. Revisa las credenciales.`,
      });
      return;
    }
    if (mode === "test") {
      setMessage({ kind: "ok", text: "Conexión correcta" });
      return;
    }
    const data = (await res.json()) as { connection: Connection };
    setConnection(data.connection);
    setMessage({ kind: "ok", text: `${meta.label} conectado` });
  }

  async function disconnect() {
    setBusy(true);
    await fetch(`/api/settings/${connector}`, { method: "DELETE" }).catch(
      () => null
    );
    setBusy(false);
    setConnection(null);
    setValues({});
    setSyncTasks(false);
    setMessage(null);
  }

  /** Interruptor de sincronización de tareas: va por su cuenta, sin secretos. */
  async function toggleSync(next: boolean) {
    setBusy(true);
    const res = await fetch(`/api/settings/${connector}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ syncTasks: next }),
    }).catch(() => null);
    setBusy(false);

    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setMessage({
        kind: "error",
        text:
          data?.error?.message ??
          "No se pudo cambiar la sincronización de tareas.",
      });
      return;
    }
    setSyncTasks(next);
    setMessage({
      kind: "ok",
      text: next
        ? "Sincronización de tareas encendida"
        : "Sincronización de tareas apagada",
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conectar {meta.label}</CardTitle>
        <CardDescription>{help.title}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-xs text-text-2">
          {help.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>

        {connector === "google" && redirectUri && (
          <div className="space-y-1.5">
            <Label htmlFor={`${connector}-redirectUri`}>URI de redirección</Label>
            <Input id={`${connector}-redirectUri`} readOnly value={redirectUri} />
            <p className="text-xs text-text-3">
              Pégala en Google Cloud → Credenciales OAuth → URIs de redirección autorizadas.
            </p>
          </div>
        )}

        {connection?.status === "error" && (
          <p className="rounded-sm border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
            {meta.label} rechazó las últimas credenciales. Las citas se siguen
            agendando, pero sin enlace hasta que vuelvas a conectar.
          </p>
        )}

        <div className="space-y-3">
          {fields.map((f) => (
            <div key={f.name} className="space-y-1.5">
              <Label htmlFor={`${connector}-${f.name}`}>{f.label}</Label>
              <Input
                id={`${connector}-${f.name}`}
                type={f.secret ? "password" : "text"}
                value={values[f.name] ?? ""}
                placeholder={
                  f.secret && connection?.secretLast4
                    ? `•••• ${connection.secretLast4}`
                    : f.placeholder
                }
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.name]: e.target.value }))
                }
              />
              {f.help && <p className="text-xs text-text-3">{f.help}</p>}
            </div>
          ))}
        </div>

        {connector === "google" && connection && (
          <div className="space-y-1.5 rounded-sm border border-border px-3 py-2.5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary"
                checked={syncTasks}
                disabled={busy}
                onChange={(e) => toggleSync(e.target.checked)}
              />
              Sincronizar mis Pendientes y tareas de proyecto
            </label>
            <p className="text-xs text-text-3">
              Cada tarea con fecha se crea como evento en{" "}
              {values.calendarId || "tu calendario"}: editarla mueve ese mismo
              evento y borrarla lo elimina. Apagarlo no borra los eventos ya
              creados.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {connector === "google" && (
            <Button
              variant="outline"
              onClick={() => void connectWithGoogle()}
              disabled={busy}
            >
              Autorizar con Google
            </Button>
          )}
          <Button variant="outline" onClick={() => submit("test")} disabled={busy}>
            Probar
          </Button>
          <Button onClick={() => submit("save")} disabled={busy}>
            {connection ? "Actualizar" : "Conectar"}
          </Button>
          {connection && (
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="text-sm text-text-3 hover:text-foreground"
            >
              Desconectar
            </button>
          )}
          {message && (
            <span
              className={
                message.kind === "ok"
                  ? "text-sm text-brand-text"
                  : "text-sm text-destructive"
              }
            >
              {message.text}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
