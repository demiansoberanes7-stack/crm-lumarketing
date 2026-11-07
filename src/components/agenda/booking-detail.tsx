"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { zonedInputToUtc } from "@/lib/caltodo";
import { webHref } from "@/lib/safe-url";
import { hhmm } from "@/lib/agenda/view-model";
import { STATUS_LABEL } from "@/components/agenda/labels";
import type { BookingDto, SlotDto } from "@/lib/agenda/dto";

/**
 * El panel de una cita: primero se lee, luego se edita.
 *
 * Solo habla con el mundo a través de `onAct`, que es el `PATCH` del contenedor
 * —el que refresca la disponibilidad después de cada operación—. Cada campo
 * nuevo que se edite aquí tiene su acción ya hecha en el servidor
 * (`update`, `reschedule`, `status`, `cancel`, `retry_link`); no se inventa
 * ninguna.
 */

const STATUS_BADGE: Record<BookingDto["status"], "default" | "success" | "warning" | "secondary"> =
  {
    agendada: "default",
    realizada: "success",
    no_show: "warning",
    cancelada: "secondary",
  };

export function BookingDetail({
  booking,
  timezone,
  slots,
  busy,
  onAct,
  onClose,
}: {
  booking: BookingDto;
  timezone: string;
  slots: SlotDto[];
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  const isBlock = booking.kind === "block";
  const [title, setTitle] = useState(booking.title ?? "");
  const [location, setLocation] = useState(booking.location ?? "");
  const [duration, setDuration] = useState(booking.durationMinutes);
  const [notes, setNotes] = useState(booking.notes ?? "");
  const [rescheduling, setRescheduling] = useState(false);
  const [customDay, setCustomDay] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [moveError, setMoveError] = useState<string | null>(null);

  const dirty =
    title !== (booking.title ?? "") ||
    location !== (booking.location ?? "") ||
    duration !== booking.durationMinutes ||
    notes !== (booking.notes ?? "");

  // Se ofrecen TODOS los huecos del rango visible, no solo los de otro día: el
  // que ya no esté libre lo dirá el servidor, y ese mensaje es más útil que un
  // filtrado hecho aquí con la zona del navegador.
  const nearSlots = slots.filter((s) => s.startUtc !== booking.scheduledAtUtc);

  async function saveFields() {
    const ok = await onAct({
      action: "update",
      title: title.trim() || null,
      location: location.trim() || null,
      notes: notes.trim() || null,
      durationMinutes: duration,
    });
    if (ok) setRescheduling(false);
  }

  async function moveUtc(startUtc: string) {
    setMoveError(null);
    await onAct({ action: "reschedule", startUtc });
  }

  // La hora se lee en la ZONA DEL CALENDARIO, igual que en el alta: si se
  // interpretara con la del navegador, la cita llegaría corrida.
  async function moveCustom() {
    if (!customDay || !customStart) return;
    const when = zonedInputToUtc(`${customDay}T${customStart}`, timezone);
    if (!when) {
      setMoveError("Esa fecha y hora no se pueden interpretar.");
      return;
    }
    await moveUtc(when.toISOString());
  }

  return (
    <aside className="space-y-4 rounded-md border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">
            {booking.title ?? (isBlock ? "Bloqueo" : "Cita")}
          </h3>
          <p className="text-xs text-text-3">
            {booking.weekday} {booking.date} · {booking.time} –{" "}
            {hhmm(booking.endMinutes)} · {booking.durationMinutes} min
          </p>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Cerrar">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-1">
        <Badge variant={STATUS_BADGE[booking.status]}>
          {STATUS_LABEL[booking.status]}
        </Badge>
        {isBlock ? (
          <Badge variant="secondary">Bloqueo</Badge>
        ) : (
          <Badge variant="secondary">
            {booking.source === "ai"
              ? "Agendó la IA"
              : booking.source === "google"
                ? "Google Calendar"
                : "Manual"}
          </Badge>
        )}
        {booking.isTest && <Badge variant="secondary">Prueba</Badge>}
        {booking.linkPending && booking.status !== "cancelada" && (
          <Badge variant="warning">Sin enlace</Badge>
        )}
      </div>

      <dl className="space-y-1 text-sm">
        {!isBlock && (
          <Row label="Contacto">
            {booking.contact?.name || "Sin contacto"}
          </Row>
        )}
        <Row label="Responsable">{booking.assigneeName ?? "Sin asignar"}</Row>
        <Row label="Lugar o modalidad">{booking.location ?? "Sin indicar"}</Row>
        {booking.meetingLink && (
          <Row label="Enlace">
            <a
              href={webHref(booking.meetingLink) ?? undefined}
              target="_blank"
              rel="noreferrer noopener"
              className="text-brand-text hover:underline"
            >
              Unirse a la reunión
            </a>
          </Row>
        )}
        {booking.notes && <Row label="Notas">{booking.notes}</Row>}
      </dl>

      {/* Editar lo que la cita es, sin mover su instante. `update` existe justo
          para esto: corregir una nota jamás debe re-validar el hueco. */}
      <div className="space-y-2 border-t pt-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="det-title">Motivo</Label>
            <Input
              id="det-title"
              value={title}
              maxLength={255}
              disabled={isBlock}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="det-loc">Lugar o modalidad</Label>
            <Input
              id="det-loc"
              value={location}
              maxLength={255}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="det-dur">Duración (min)</Label>
            <Input
              id="det-dur"
              type="number"
              min={5}
              max={600}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="det-notes">Notas</Label>
            <Input
              id="det-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <Button size="sm" onClick={() => void saveFields()} disabled={busy || !dirty}>
          {busy ? "Guardando…" : "Guardar cambios"}
        </Button>
        {!dirty && (
          <p className="text-xs text-text-3">
            Nada por guardar: cambia un campo y vuelve a intentar.
          </p>
        )}
      </div>

      {booking.linkPending && booking.status !== "cancelada" && (
        <div className="space-y-2 rounded-sm bg-subtle p-2">
          <p className="text-sm text-text-2">
            Esta cita quedó sin enlace: el proveedor no respondió.
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void onAct({ action: "retry_link" })}
          >
            Reintentar enlace
          </Button>
        </div>
      )}

      {booking.status === "agendada" && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setRescheduling((r) => !r)}
          >
            {rescheduling ? "Quitar reprogramación" : "Reprogramar"}
          </Button>
          {!isBlock && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void onAct({ action: "status", status: "realizada" })}
              >
                Realizada
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void onAct({ action: "status", status: "no_show" })}
              >
                No asistió
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void onAct({ action: "cancel" })}
          >
            {isBlock ? "Quitar bloqueo" : "Cancelar"}
          </Button>
        </div>
      )}

      {rescheduling && (
        <div className="space-y-2 rounded-sm bg-subtle p-2">
          <p className="text-xs text-text-3">
            Huecos libres de tu horario. Si el que quieres no está, impón la hora
            y el servidor dirá por qué no.
          </p>
          {nearSlots.length === 0 && (
            <p className="text-sm text-text-3">
              No hay huecos libres en el rango que estás viendo.
            </p>
          )}
          <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
            {nearSlots.slice(0, 40).map((s) => (
              <Button
                key={s.startUtc}
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void moveUtc(s.startUtc)}
              >
                {s.dayLabel}, {s.time}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="res-day">Día</Label>
              <Input
                id="res-day"
                type="date"
                value={customDay}
                onChange={(e) => setCustomDay(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="res-start">Hora</Label>
              <Input
                id="res-start"
                type="time"
                step={300}
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-32"
              />
            </div>
            <Button
              size="sm"
              disabled={busy || !customDay || !customStart}
              onClick={() => void moveCustom()}
            >
              Mover
            </Button>
          </div>
          {moveError && <p className="text-xs text-danger">{moveError}</p>}
        </div>
      )}
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-36 shrink-0 text-xs uppercase tracking-wide text-text-3">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}
