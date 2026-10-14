"use client";

import { useState } from "react";
import { CalendarClock, X } from "lucide-react";
import type { ContactDto } from "@/lib/types";
import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Programar un mensaje personalizado a un contacto específico.
 * Usa el sistema de broadcasts: crea una campaña con un solo destinatario
 * y `scheduledAt` en el futuro; el worker la enviará cuando llegue la hora.
 */
export function ScheduleMessageDialog({
  contact,
  onClose,
}: {
  contact: ContactDto;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const channel = (contact.channel || "whatsapp") as Channel;
  const channelLabel = CHANNEL_LABEL[channel] ?? contact.channel;

  async function guardar() {
    setSaving(true);
    setError(null);
    const iso = `${date}T${time}:00`;
    const scheduledAt = new Date(iso);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      setSaving(false);
      setError("Elige una fecha y hora en el futuro.");
      return;
    }
    const res = await fetch("/api/broadcasts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `Programado · ${contact.name}`,
        messageText: message.trim(),
        channel,
        filters: { contactIds: [contact.id] },
        scheduledAt: scheduledAt.toISOString(),
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo programar el mensaje.");
      return;
    }
    setOk(true);
  }

  if (ok) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
        <div
          role="dialog"
          aria-label="Mensaje programado"
          className="w-full max-w-sm rounded-lg border bg-card p-5 text-center shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <CalendarClock className="mx-auto mb-3 h-8 w-8 text-success" />
          <p className="font-semibold">Mensaje programado</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Se enviará a <strong>{contact.name}</strong> por {channelLabel} el{" "}
            {new Date(`${date}T${time}`).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}.
          </p>
          <Button className="mt-4" onClick={onClose}>Entendido</Button>
        </div>
      </div>
    );
  }

  // Mínimo: ahora + 5 minutos (el worker tarda ~2s por tick).
  const minDate = new Date(Date.now() + 5 * 60_000);
  const minDateStr = minDate.toISOString().slice(0, 10);
  const minTimeStr = date === minDateStr
    ? `${String(minDate.getHours()).padStart(2, "0")}:${String(minDate.getMinutes()).padStart(2, "0")}`
    : "00:00";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Programar mensaje a ${contact.name}`}
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Programar mensaje</h3>
            <p className="text-sm text-muted-foreground">
              A <strong>{contact.name}</strong> · por {channelLabel}
            </p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="sm-msg">
              Mensaje
            </label>
            <Textarea
              id="sm-msg"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Hola {nombre}, te escribimos para recordarte…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="sm-date">
                Fecha
              </label>
              <Input
                id="sm-date"
                type="date"
                value={date}
                min={minDateStr}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="sm-time">
                Hora
              </label>
              <Input
                id="sm-time"
                type="time"
                value={time}
                min={minTimeStr}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Se enviará dentro de la ventana de atención de {channelLabel}. Si la
            ventana está cerrada, el sistema lo omitirá y lo marcará como
            «ventana cerrada» en Campañas.
          </p>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={!message.trim() || !date || !time || saving}
            onClick={() => void guardar()}
          >
            <CalendarClock className="mr-1.5 h-4 w-4" />
            {saving ? "Programando…" : "Programar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
