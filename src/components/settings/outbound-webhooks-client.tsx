"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
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

const AVAILABLE_EVENTS = [
  { value: "contact.created", label: "Contacto creado" },
  { value: "lead.updated", label: "Lead actualizado" },
  { value: "message.new", label: "Mensaje nuevo" },
  { value: "quote.sent", label: "Cotización enviada" },
  { value: "payment.received", label: "Pago recibido" },
  { value: "project.stage_changed", label: "Etapa de proyecto cambiada" },
];

type Webhook = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secret: string | null;
  createdAt: string;
};

type Delivery = {
  id: string;
  webhookId: string;
  event: string;
  status: "success" | "failed";
  statusCode: number | null;
  at: string;
  error: string | null;
};

export function OutboundWebhooksClient() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [deliveriesWebhookId, setDeliveriesWebhookId] = useState<string | null>(null);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);

  const loadWebhooks = useCallback(async () => {
    const res = await fetch("/api/settings/outbound-webhooks").catch(() => null);
    if (!res?.ok) return setWebhooks([]);
    const data = (await res.json()) as { webhooks: Webhook[] };
    setWebhooks(data.webhooks);
  }, []);

  useEffect(() => {
    void (async () => {
      await loadWebhooks();
      setLoading(false);
    })();
  }, [loadWebhooks]);

  function toggleEvent(event: string) {
    setNewEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  }

  async function createWebhook() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/settings/outbound-webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: newUrl.trim(),
        events: newEvents,
        ...(newSecret.trim() ? { secret: newSecret.trim() } : {}),
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(body?.error?.message ?? "No se pudo crear el webhook");
      return;
    }
    setNewUrl("");
    setNewEvents([]);
    setNewSecret("");
    setShowForm(false);
    await loadWebhooks();
  }

  async function deleteWebhook(id: string) {
    await fetch(`/api/settings/outbound-webhooks/${id}`, { method: "DELETE" }).catch(() => null);
    await loadWebhooks();
    if (deliveriesWebhookId === id) {
      setDeliveries(null);
      setDeliveriesWebhookId(null);
    }
  }

  async function loadDeliveries(webhookId: string) {
    if (deliveriesWebhookId === webhookId && deliveries) {
      setDeliveries(null);
      setDeliveriesWebhookId(null);
      return;
    }
    setLoadingDeliveries(true);
    setDeliveriesWebhookId(webhookId);
    const res = await fetch(`/api/settings/outbound-webhooks/${webhookId}/deliveries`).catch(
      () => null
    );
    setLoadingDeliveries(false);
    if (!res?.ok) return setDeliveries([]);
    const data = (await res.json()) as { deliveries: Delivery[] };
    setDeliveries(data.deliveries);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Webhooks Salientes</CardTitle>
          <CardDescription>
            Envía eventos del CRM a servicios externos mediante HTTP POST.
            Cada webhook recibe un payload JSON con la información del evento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : webhooks.length === 0 && !showForm ? (
            <p className="text-sm text-muted-foreground">
              No hay webhooks configurados. Crea uno para empezar a enviar
              eventos a tus servicios.
            </p>
          ) : (
            <div className="space-y-2">
              {webhooks.map((wh) => (
                <div
                  key={wh.id}
                  className="rounded-md border border-border-strong px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{wh.url}</span>
                        <Badge variant={wh.active ? "success" : "secondary"}>
                          {wh.active ? "Activo" : "Inactivo"}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {wh.events.map((ev) => (
                          <Badge key={ev} variant="outline" className="text-xs">
                            {AVAILABLE_EVENTS.find((e) => e.value === ev)?.label ?? ev}
                          </Badge>
                        ))}
                      </div>
                      {wh.secret && (
                        <span className="text-xs text-muted-foreground">
                          Secreto: ····{wh.secret.slice(-4)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={loadingDeliveries}
                        onClick={() => void loadDeliveries(wh.id)}
                      >
                        {deliveriesWebhookId === wh.id && deliveries
                          ? "Ocultar"
                          : "Entregas"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void deleteWebhook(wh.id)}
                      >
                        Eliminar
                      </Button>
                    </div>
                  </div>

                  {deliveriesWebhookId === wh.id && (
                    <div className="mt-3 border-t border-border-strong pt-3">
                      {loadingDeliveries ? (
                        <p className="text-xs text-muted-foreground">Cargando entregas…</p>
                      ) : !deliveries || deliveries.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No hay entregas registradas.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {deliveries.map((d) => (
                            <div
                              key={d.id}
                              className="flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={d.status === "success" ? "success" : "destructive"}
                                >
                                  {d.status === "success" ? "Éxito" : "Falló"}
                                </Badge>
                                <span className="text-muted-foreground">{d.event}</span>
                                {d.statusCode && (
                                  <span className="text-muted-foreground">
                                    HTTP {d.statusCode}
                                  </span>
                                )}
                              </div>
                              <span className="whitespace-nowrap text-muted-foreground">
                                {new Date(d.at).toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!showForm && (
            <Button variant="outline" onClick={() => setShowForm(true)}>
              Nuevo Webhook
            </Button>
          )}

          {showForm && (
            <div className="space-y-4 rounded-md border border-border-strong p-4">
              <div className="space-y-1.5">
                <Label htmlFor="wh-url">URL del Webhook</Label>
                <Input
                  id="wh-url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://ejemplo.com/webhook"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Eventos</Label>
                <div className="grid grid-cols-2 gap-2">
                  {AVAILABLE_EVENTS.map((ev) => (
                    <label
                      key={ev.value}
                      className="flex items-center gap-2 rounded-md border border-border-strong px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        checked={newEvents.includes(ev.value)}
                        onChange={() => toggleEvent(ev.value)}
                        className="h-3.5 w-3.5 rounded border-input"
                      />
                      {ev.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wh-secret">Secreto (opcional)</Label>
                <Input
                  id="wh-secret"
                  value={newSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                  placeholder="Para firmar el payload"
                  autoComplete="off"
                  className="max-w-xs"
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-2">
                <Button
                  disabled={saving || !newUrl.trim() || newEvents.length === 0}
                  onClick={() => void createWebhook()}
                >
                  {saving ? "Creando…" : "Crear Webhook"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    setError(null);
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
