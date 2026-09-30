"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, ExternalLink, RotateCcw, Zap, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type Webhook = {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
};

type Delivery = {
  id: string;
  event: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
};

type EventLabel = Record<string, string>;

export function WebhooksClient() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [eventLabels, setEventLabels] = useState<EventLabel>({});
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [error, setError] = useState("");
  const [openDeliveries, setOpenDeliveries] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState("");

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/webhooks").catch(() => null);
    if (!res?.ok) {
      setError("No se pudo cargar la lista de webhooks");
      return;
    }
    const data = (await res.json()) as {
      webhooks: Webhook[];
      availableEvents: string[];
      eventLabels: EventLabel;
    };
    setWebhooks(data.webhooks);
    setAvailableEvents(data.availableEvents);
    setEventLabels(data.eventLabels);
    setError("");
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function deleteWebhook(id: string) {
    if (!confirm("¿Eliminar este webhook permanentemente?")) return;
    const res = await fetch(`/api/settings/webhooks/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) setError("No se pudo eliminar el webhook");
    void refetch();
  }

  async function toggleActive(webhook: Webhook) {
    const res = await fetch(`/api/settings/webhooks/${webhook.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !webhook.active }),
    }).catch(() => null);
    if (!res?.ok) setError("No se pudo cambiar el estado del webhook");
    void refetch();
  }

  /**
   * "Probar envío": dispara un `webhook.test` real y trae el veredicto en la
   * misma respuesta. Sin esto, configurar un webhook era un acto de fe.
   */
  async function testWebhook(id: string) {
    setTesting(id);
    setTestResult("");
    const res = await fetch(`/api/settings/webhooks/${id}/test`, { method: "POST" }).catch(() => null);
    if (!res) {
      setTesting(null);
      setTestResult("No se pudo contactar al servidor");
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      status?: number | null;
      ms?: number;
      attempts?: number;
      error?: string | null;
      message?: string;
    } | null;
    setTesting(null);
    if (!res.ok) {
      setTestResult(data?.message ?? data?.error ?? "No se pudo probar el webhook");
      return;
    }
    setTestResult(
      data?.ok
        ? `Entregado ✓ HTTP ${data.status} en ${data.ms} ms`
        : `Falló ✗ ${data?.status ? `HTTP ${data.status}` : "sin respuesta"} — ${data?.error ?? "sin detalle"}`
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">Webhooks de salida</h3>
          <p className="text-sm text-muted-foreground">
            Envía notificaciones a servicios externos cuando ocurran eventos en el CRM.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Destinos en <code>http://</code> o de red privada requieren listarse en{" "}
            <code>WEBHOOK_TRUSTED_HOSTS</code>; el resto debe ser HTTPS.
          </p>
        </div>
        <Button size="sm" onClick={() => { setShowNew(true); setEditing(null); }}>
          <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
          Nuevo Webhook
        </Button>
      </header>

      {error && <p role="alert" className="text-destructive">{error}</p>}
      {testResult && <p role="status" className="text-sm text-muted-foreground">{testResult}</p>}

      {webhooks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm font-medium">Sin webhooks configurados</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Crea un webhook para enviar datos a tu sistema externo, Zapier, Make, etc.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => (
            <div key={wh.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{wh.name}</span>
                    <Badge variant={wh.active ? "success" : "secondary"}>
                      {wh.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <ExternalLink className="h-3 w-3" />
                    <span className="truncate">{wh.url}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {wh.events.map((ev) => (
                      <Badge key={ev} variant="outline" className="text-xs">
                        {eventLabels[ev] ?? ev}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Probar envío"
                    disabled={testing === wh.id}
                    onClick={() => void testWebhook(wh.id)}
                  >
                    <Zap className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title={openDeliveries === wh.id ? "Ocultar entregas" : "Ver entregas"}
                    onClick={() => setOpenDeliveries((cur) => (cur === wh.id ? null : wh.id))}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title={wh.active ? "Desactivar" : "Activar"}
                    onClick={() => void toggleActive(wh)}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Editar"
                    onClick={() => { setEditing(wh); setShowNew(true); }}
                  >
                    <span className="text-xs">✏️</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Eliminar"
                    onClick={() => void deleteWebhook(wh.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              {openDeliveries === wh.id && <DeliveriesPanel webhookId={wh.id} />}
            </div>
          ))}
        </div>
      )}

      {(showNew || editing) && (
        <WebhookForm
          availableEvents={availableEvents}
          eventLabels={eventLabels}
          existing={editing}
          onClose={() => { setShowNew(false); setEditing(null); setError(""); }}
          onSaved={() => { setShowNew(false); setEditing(null); setError(""); void refetch(); }}
          onError={setError}
        />
      )}
    </div>
  );
}

/** Historial de entregas de un webhook (Éxito/Falló · evento · HTTP · intentos). */
function DeliveriesPanel({ webhookId }: { webhookId: string }) {
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/settings/webhooks/${webhookId}/deliveries?limit=20`).catch(() => null);
      if (cancelled) return;
      if (!res?.ok) {
        setError("No se pudo cargar el historial");
        return;
      }
      const data = (await res.json()) as { deliveries: Delivery[] };
      setRows(data.deliveries);
    })();
    return () => { cancelled = true; };
  }, [webhookId]);

  if (error) return <p className="mt-3 text-xs text-destructive">{error}</p>;
  if (!rows) return <p className="mt-3 text-xs text-muted-foreground">Cargando entregas…</p>;
  if (rows.length === 0)
    return <p className="mt-3 text-xs text-muted-foreground">Todavía no se ha entregado nada.</p>;

  return (
    <div className="mt-3 space-y-1 border-t pt-3">
      {rows.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={d.status === "delivered" ? "success" : d.status === "failed" ? "destructive" : "secondary"}>
            {d.status === "delivered" ? "Éxito" : d.status === "failed" ? "Falló" : d.status}
          </Badge>
          <span className="text-muted-foreground">{eventLabelSafe(d.event)}</span>
          {d.lastStatusCode !== null && <span className="text-muted-foreground">HTTP {d.lastStatusCode}</span>}
          <span className="text-muted-foreground">{d.attempts} intento{d.attempts === 1 ? "" : "s"}</span>
          <time className="text-muted-foreground">
            {new Date(d.deliveredAt ?? d.createdAt).toLocaleString("es-MX")}
          </time>
          {d.lastError && (
            <details className="w-full">
              <summary className="cursor-pointer text-muted-foreground">Ver error</summary>
              <p className="break-all text-destructive">{d.lastError}</p>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

function eventLabelSafe(event: string): string {
  const LABELS: Record<string, string> = { "webhook.test": "Prueba manual" };
  return LABELS[event] ?? event;
}

function WebhookForm({
  availableEvents,
  eventLabels,
  existing,
  onClose,
  onSaved,
  onError,
}: {
  availableEvents: string[];
  eventLabels: EventLabel;
  existing: Webhook | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [secret, setSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [events, setEvents] = useState<string[]>(existing?.events ?? []);
  const [saving, setSaving] = useState(false);
  const [selectAll, setSelectAll] = useState(false);

  function toggleEvent(ev: string) {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]
    );
  }

  function toggleAll() {
    if (selectAll) {
      setEvents([]);
      setSelectAll(false);
    } else {
      setEvents([...availableEvents]);
      setSelectAll(true);
    }
  }

  async function handleSave() {
    if (!name.trim() || !url.trim() || events.length === 0) return;
    setSaving(true);
    onError("");

    const body: Record<string, unknown> = {
      name: name.trim(),
      url: url.trim(),
      events,
    };
    // `secret: ""` es la señal de "borrarlo": el servidor lo traduce en null.
    if (clearSecret) body.secret = "";
    else if (secret) body.secret = secret;

    const res = await fetch(
      existing ? `/api/settings/webhooks/${existing.id}` : "/api/settings/webhooks",
      {
        method: existing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    ).catch(() => null);

    setSaving(false);
    if (!res) {
      onError("No hay conexión con el servidor");
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      onError(err?.error?.message ?? "No se pudo guardar el webhook");
      return;
    }
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-semibold">
          {existing ? "Editar Webhook" : "Nuevo Webhook"}
        </h3>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mi sistema externo"
            />
          </div>
          <div className="space-y-1.5">
            <Label>URL del webhook</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mi-sistema.com/webhook"
            />
            <p className="text-xs text-muted-foreground">
              Debe ser <code>https://</code> y apuntar a una IP pública. Servicios
              propios en tu red se autorizan con <code>WEBHOOK_TRUSTED_HOSTS</code>.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Secreto de firma (opcional)</Label>
            <Input
              type="password"
              value={secret}
              onChange={(e) => { setSecret(e.target.value); setClearSecret(false); }}
              placeholder="Se usa para firmar el payload con HMAC-SHA256"
              disabled={clearSecret}
            />
            <p className="text-xs text-muted-foreground">
              Si lo configuras, el webhook incluirá un header `X-Webhook-Signature` con la firma HMAC-SHA256 del payload.
            </p>
            {existing && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={clearSecret}
                  onChange={(e) => setClearSecret(e.target.checked)}
                  className="accent-primary"
                />
                Quitar el secreto guardado
              </label>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Eventos</Label>
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs text-primary hover:underline"
              >
                {selectAll ? "Ninguno" : "Todos"}
              </button>
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
              {availableEvents.map((ev) => (
                <label key={ev} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={events.includes(ev)}
                    onChange={() => toggleEvent(ev)}
                    className="accent-primary"
                  />
                  <span className="text-muted-foreground">{eventLabels[ev] ?? ev}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={saving || !name.trim() || !url.trim() || events.length === 0}
            onClick={() => void handleSave()}
          >
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
