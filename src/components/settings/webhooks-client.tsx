"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, ExternalLink, RotateCcw } from "lucide-react";
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

type EventLabel = Record<string, string>;

export function WebhooksClient() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [eventLabels, setEventLabels] = useState<EventLabel>({});
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [error, setError] = useState("");

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/webhooks").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as {
      webhooks: Webhook[];
      availableEvents: string[];
      eventLabels: EventLabel;
    };
    setWebhooks(data.webhooks);
    setAvailableEvents(data.availableEvents);
    setEventLabels(data.eventLabels);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function deleteWebhook(id: string) {
    if (!confirm("¿Eliminar este webhook permanentemente?")) return;
    await fetch(`/api/settings/webhooks/${id}`, { method: "DELETE" }).catch(() => null);
    void refetch();
  }

  async function toggleActive(webhook: Webhook) {
    await fetch(`/api/settings/webhooks/${webhook.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !webhook.active }),
    }).catch(() => null);
    void refetch();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold">Webhooks de salida</h3>
          <p className="text-sm text-muted-foreground">
            Envía notificaciones a servicios externos cuando ocurran eventos en el CRM.
          </p>
        </div>
        <Button size="sm" onClick={() => { setShowNew(true); setEditing(null); }}>
          <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
          Nuevo Webhook
        </Button>
      </header>

      {error && <p role="alert" className="text-destructive">{error}</p>}

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
    if (secret) body.secret = secret;

    const res = await fetch(
      existing ? `/api/settings/webhooks/${existing.id}` : "/api/settings/webhooks",
      {
        method: existing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    ).catch(() => null);

    setSaving(false);
    if (!res?.ok) {
      const err = await res?.json().catch(() => null);
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
          </div>
          <div className="space-y-1.5">
            <Label>Secreto de firma (opcional)</Label>
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Se usa para firmar el payload con HMAC-SHA256"
            />
            <p className="text-xs text-muted-foreground">
              Si lo configuras, el webhook incluirá un header `X-Webhook-Signature` con la firma HMAC-SHA256 del payload.
            </p>
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
