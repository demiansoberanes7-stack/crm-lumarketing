"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, PlugZap, RefreshCw } from "lucide-react";

type ConnectionStatus = {
  channels: string[];
  zernio: string;
  instagram: string;
  messenger: string;
  tiktok: string;
};

type Diagnostics = { status: ConnectionStatus };

/** Estado de las conexiones que no son de mensajería (resuelto en una sola llamada). */
type ConnectionsStatus = {
  status: Record<string, string>;
  meta_ads_account: string | null;
  ga4_property: string | null;
  google_ads_customer: string | null;
  calendar_id: string | null;
  google_business_last_sync: string | null;
  email_accounts: string[];
};

const CONNECTIONS = [
  { key: "zernio", channel: "whatsapp", name: "WhatsApp · Zernio", href: "/settings/whatsapp", detail: "Número de WhatsApp Business conectado mediante Zernio." },
  { key: "instagram", channel: "instagram", name: "Instagram · Zernio / Meta", href: "/settings/instagram", detail: "Cuenta de Instagram para recibir y responder mensajes." },
  { key: "messenger", channel: "messenger", name: "Messenger · Zernio / Meta", href: "/settings/messenger", detail: "Página de Facebook para mensajes de Messenger." },
  { key: "tiktok", channel: "tiktok", name: "TikTok · Zernio", href: "/settings/tiktok", detail: "Cuenta de TikTok conectada mediante Zernio." },
] as const;

/** Conexiones de datos/publicidad: se resuelven con /api/settings/connections-status. */
const DATA_CONNECTIONS = [
  {
    key: "meta_ads",
    name: "Meta Ads",
    href: "/settings/marketing",
    detail: "Token de acceso y cuenta de anuncios para leer campañas de Facebook e Instagram.",
    activationSetting: null as string | null,
    hint: "Si Meta devuelve OAuthException 190 (subcode 460), el token del System User fue invalidado: regeneralo en Business Suite → Usuarios del sistema con permiso ads_read.",
    account: (s: ConnectionsStatus) => s.meta_ads_account,
  },
  {
    key: "ga4",
    name: "Google Analytics 4",
    href: "/settings/marketing",
    detail: "Propiedad GA4 con service account para importar métricas de tráfico y conversiones.",
    activationSetting: null,
    hint: null as string | null,
    account: (s: ConnectionsStatus) => s.ga4_property ? `Propiedad ${s.ga4_property}` : null,
  },
  {
    key: "google_ads",
    name: "Google Ads",
    href: "/settings/marketing",
    detail: "Cuenta de cliente con developer token para leer campañas y costos de Google Ads.",
    activationSetting: null,
    hint: null,
    account: (s: ConnectionsStatus) => s.google_ads_customer ? `Cliente ${s.google_ads_customer}` : null,
  },
  {
    key: "calendar",
    name: "Google Calendar",
    href: "/settings/google",
    detail: "App de Google Cloud del negocio para agendar citas en el calendario.",
    activationSetting: "AGENDA=on",
    hint: null,
    account: (s: ConnectionsStatus) => s.calendar_id,
  },
  {
    key: "google_business",
    name: "Google Business Profile",
    href: "/settings/google-business",
    detail: "Cuenta del negocio para leer reseñas y responderlas desde la Bandeja.",
    activationSetting: "GOOGLE_BUSINESS=on",
    hint: null,
    account: (s: ConnectionsStatus) =>
      s.google_business_last_sync
        ? `Última lectura ${new Date(s.google_business_last_sync).toLocaleString("es-MX")}`
        : null,
  },
  {
    key: "capi",
    name: "Conversions API (Meta)",
    href: "/settings/ads",
    detail: "Dataset de Meta para enviar eventos de conversión desde el CRM (atribución de anuncios).",
    activationSetting: "ATRIBUCION=on",
    hint: null,
    account: () => null,
  },
  {
    key: "email",
    name: "Buzón de correo",
    href: "/settings/email",
    detail: "Cuentas IMAP/SMTP para recibir y responder correos desde la Bandeja.",
    activationSetting: null,
    hint: null,
    account: (s: ConnectionsStatus) => s.email_accounts.length > 0 ? s.email_accounts.join(", ") : null,
  },
] as const;

const STATUS_LABEL: Record<string, string> = {
  connected: "Credenciales guardadas",
  reconnect_required: "Requiere reconexión",
  not_configured: "Sin configurar",
  disabled: "Apagado en el despliegue",
};

export function ConnectionsClient() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [accounts, setAccounts] = useState<Record<string, string | null>>({});
  const [connections, setConnections] = useState<ConnectionsStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const [response, connectionsResponse] = await Promise.all([
      fetch("/api/settings/diagnostics", { cache: "no-store" }).catch(() => null),
      fetch("/api/settings/connections-status", { cache: "no-store" }).catch(() => null),
    ]);
    const payload = await response?.json().catch(() => null) as Diagnostics | null;
    const connectionsPayload = connectionsResponse?.ok
      ? await connectionsResponse.json().catch(() => null) as ConnectionsStatus | null
      : null;
    if (!response?.ok || !payload?.status) {
      setError("No se pudieron cargar las conexiones. Intenta actualizar la vista.");
    } else {
      setData(payload);
      setConnections(connectionsPayload);
      const endpoints = [
        ["zernio", payload.status.zernio !== "disabled" ? "/api/settings/whatsapp/zernio" : null],
        ["instagram", payload.status.channels.includes("instagram") ? "/api/settings/instagram" : null],
        ["messenger", payload.status.channels.includes("messenger") ? "/api/settings/messenger" : null],
        ["tiktok", payload.status.channels.includes("tiktok") ? "/api/settings/tiktok" : null],
      ] as const;
      const details = await Promise.all(endpoints.map(async ([key, endpoint]) => {
        if (!endpoint) return [key, null] as const;
        const result = await fetch(endpoint, { cache: "no-store" }).catch(() => null);
        if (!result?.ok) return [key, null] as const;
        const detail = await result.json().catch(() => null) as { connection?: {
          displayPhone?: string | null;
          accountId?: string | null;
          username?: string | null;
          accountRef?: string | null;
          pageName?: string | null;
          pageId?: string | null;
        } | null } | null;
        const connection = detail?.connection;
        const account = key === "zernio"
          ? connection?.displayPhone ?? connection?.accountId
          : key === "messenger"
            ? connection?.pageName ?? connection?.pageId
            : connection?.username ?? connection?.accountRef;
        return [key, account?.trim() || null] as const;
      }));
      setAccounts(Object.fromEntries(details));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Conexiones</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-2">
            Estado de las cuentas de mensajería, datos y publicidad. Las API keys y los tokens se guardan de forma segura desde cada formulario del CRM.
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="flex min-h-11 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50">
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Actualizar
        </button>
      </header>

      {error && <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">{error}</p>}

      <section aria-label="Conexiones de mensajería" className="grid min-w-0 gap-3 sm:grid-cols-2">
        {CONNECTIONS.map((connection) => {
          const isEnabled = data ? (connection.channel === "whatsapp"
            ? data.status.zernio !== "disabled"
            : data.status.channels.includes(connection.channel)) : false;
          const status = connection.key === "zernio"
            ? data?.status.zernio
            : data?.status[connection.key as "instagram" | "messenger" | "tiktok"];
          const disabled = Boolean(data && (!isEnabled || status === "disabled"));
          const activationSetting = connection.channel === "whatsapp"
            ? "WHATSAPP_ZERNIO_ENABLED=true"
            : "CHANNELS=whatsapp,instagram,messenger,tiktok";
          return (
            <article key={connection.key} className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand-text">
                  <PlugZap className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{connection.name}</h2>
                  <p className="mt-1 text-sm text-text-2">{connection.detail}</p>
                  {accounts[connection.key] && <p className="mt-2 truncate text-xs font-medium text-text-3">Cuenta: {accounts[connection.key]}</p>}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <span className="inline-flex min-w-0 items-center gap-2 text-sm">
                  {disabled ? <CircleAlert className="h-4 w-4 shrink-0 text-warning-text" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-success-text" />}
                  <span className="truncate">{!data ? (loading ? "Consultando…" : "Sin conexión") : STATUS_LABEL[status ?? ""] ?? "Estado no disponible"}</span>
                </span>
                {data && !disabled && <Link className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent" href={connection.href}>Configurar</Link>}
              </div>
              {data && disabled && (
                <p className="rounded-md bg-subtle p-3 text-xs leading-relaxed text-text-2">
                  Para mostrar y activar esta conexión, agrega en las variables del despliegue:
                  <code className="mt-1 block break-all font-mono text-foreground">{activationSetting}</code>
                  Después podrás guardar la API key y los datos de la cuenta desde Configuración.
                </p>
              )}
            </article>
          );
        })}
      </section>

      <p className="text-xs text-text-3">
        “Credenciales guardadas” confirma que existe una configuración en el CRM; no representa una comprobación en vivo. Abre cada canal para probar o renovar su conexión.
      </p>

      <section aria-label="Conexiones de datos y publicidad" className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight text-text-2">Datos y publicidad</h2>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {DATA_CONNECTIONS.map((connection) => {
            const status = connections?.status[connection.key];
            const disabled = status === "disabled";
            const account = connections ? connection.account(connections) : null;
            return (
              <article key={connection.key} className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand-text">
                    <PlugZap className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{connection.name}</h3>
                    <p className="mt-1 text-sm text-text-2">{connection.detail}</p>
                    {account && <p className="mt-2 truncate text-xs font-medium text-text-3">Cuenta: {account}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                  <span className="inline-flex min-w-0 items-center gap-2 text-sm">
                    {disabled || status === "reconnect_required"
                      ? <CircleAlert className="h-4 w-4 shrink-0 text-warning-text" />
                      : status === "connected"
                        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success-text" />
                        : <CircleAlert className="h-4 w-4 shrink-0 text-warning-text" />}
                    <span className="truncate">
                      {!connections
                        ? (loading ? "Consultando…" : "Sin conexión")
                        : STATUS_LABEL[status ?? ""] ?? "Estado no disponible"}
                    </span>
                  </span>
                  {connections && !disabled && (
                    <Link className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent" href={connection.href}>Configurar</Link>
                  )}
                </div>
                {connections && disabled && connection.activationSetting && (
                  <p className="rounded-md bg-subtle p-3 text-xs leading-relaxed text-text-2">
                    Para activar esta conexión, agrega en las variables del despliegue:
                    <code className="mt-1 block break-all font-mono text-foreground">{connection.activationSetting}</code>
                    Después podrás guardar las credenciales desde Configuración.
                  </p>
                )}
                {connection.hint && (
                  <p className="rounded-md bg-subtle p-3 text-xs leading-relaxed text-text-2">{connection.hint}</p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
