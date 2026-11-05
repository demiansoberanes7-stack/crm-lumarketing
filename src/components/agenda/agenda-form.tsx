"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContactPicker } from "@/components/contact-picker";
import { zonedInputToUtc } from "@/lib/caltodo";
import { isValidTimeZone } from "@/lib/time/slots";
import {
  durationFromRange,
  endHHMM,
  hhmm,
  minutesOfHHMM,
} from "@/lib/agenda/view-model";
import type { SlotDto } from "@/lib/agenda/dto";

/**
 * Alta de una cita (o de un bloqueo) desde la vista de calendario.
 *
 * NO habla con la API: quien recibe el borrador ya hecho es el contenedor, que
 * es el que refresca lista y disponibilidad después de cada operación. Así el
 * formulario puede reabrirse con lo que el servidor rechazo sin duplicar el
 * camino de fetch ni esconder el error.
 *
 * La fecha y la hora se interpretan SIEMPRE en la zona del negocio
 * (`zonedInputToUtc`), no en la del navegador: un `<input type="time">` escribe
 * hora de pared sin zona, y leerla como local corrida seis horas.
 */

export type NewBookingDraft = {
  kind: "session" | "block";
  contactId: string | null;
  startUtc: string;
  durationMinutes: number;
  title: string | null;
  location: string | null;
  notes: string | null;
};

/**
 * Lo que la rejilla sabe cuando se abre el formulario.
 *
 * `startMinutes` en `null` es «día elegido, hora no»: un clic en el número del
 * mes no es un clic en las 00:00, y sembrar medianoche produciría un rechazo
 * seguro del horario. Se deja la hora vacía y los chips de huecos la proponen.
 */
export type AgendaPreset = { dayIso: string; startMinutes: number | null } | null;

/**
 * Lo que el formulario manda, decidido en UNA función pura.
 *
 * vive fuera del componente porque es la única barrera entre «hora de pared que
 * alguien tecleó» y el instante que se guarda: interpretarla con la zona del
 * navegador en vez de la del calendario corre la cita seis horas, y eso pasó de
 * verdad en el fork. Al ser pura se puede jurar en `cita-alta-manual.test.ts`
 * sin navegador y sin reloj.
 */
export type DraftInput = {
  kind: "session" | "block";
  contactId: string | null;
  day: string;
  start: string;
  durationMinutes: number;
  title: string;
  location: string;
  notes: string;
  timezone: string;
};

export function buildDraft(
  input: DraftInput
): { ok: true; draft: NewBookingDraft } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day))
    return { ok: false, error: "Falta la fecha." };
  if (minutesOfHHMM(input.start) === null)
    return { ok: false, error: "Falta una hora de inicio válida (HH:MM)." };
  if (input.durationMinutes < 5 || input.durationMinutes > 600)
    return {
      ok: false,
      error: "La duración debe estar entre 5 y 600 minutos.",
    };
  if (!isValidTimeZone(input.timezone))
    return {
      ok: false,
      error: "La zona del calendario no es válida: corrígela en Ajustes → Agenda.",
    };
  const when = zonedInputToUtc(`${input.day}T${input.start}`, input.timezone);
  if (!when) return { ok: false, error: "Esa fecha y hora no se pueden interpretar." };
  const text = (value: string): string | null => value.trim() || null;
  return {
    ok: true,
    draft: {
      kind: input.kind,
      // Un bloqueo no es una reunión con nadie: sin contacto ni motivo.
      contactId: input.kind === "session" ? input.contactId : null,
      startUtc: when.toISOString(),
      durationMinutes: input.durationMinutes,
      title: input.kind === "session" ? text(input.title) : null,
      location: text(input.location),
      notes: text(input.notes),
    },
  };
}

const MODALITIES = ["Videollamada", "Presencial", "Teléfono", "En oficina"];

export function AgendaForm({
  timezone,
  preset,
  slots,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  timezone: string;
  preset: AgendaPreset;
  slots: SlotDto[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (draft: NewBookingDraft) => Promise<void>;
}) {
  const [kind, setKind] = useState<"session" | "block">("session");
  const [contactId, setContactId] = useState<string | null>(null);
  const [day, setDay] = useState(preset?.dayIso ?? "");
  const [start, setStart] = useState(
    preset?.startMinutes != null ? hhmm(preset.startMinutes) : ""
  );
  const [endMode, setEndMode] = useState<"duration" | "end">("duration");
  const [duration, setDuration] = useState(30);
  const [end, setEnd] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  // Un clic en un hueco de la rejilla llena la fecha y la hora. Se depende de
  // los valores primitivos, no del objeto: el contenedor lo reconstruye en cada
  // render y un efecto por identidad nueva se dispararía en cada tecla.
  const presetDay = preset?.dayIso;
  const presetMinutes = preset?.startMinutes;
  useEffect(() => {
    if (!presetDay) return;
    setDay(presetDay);
    setStart(presetMinutes != null ? hhmm(presetMinutes) : "");
    setLocalError(null);
  }, [presetDay, presetMinutes]);

  // En modo «hasta», el fin se deriva de la duración al cambiarla; en modo
  // «duración», el fin escrito deja de interesar. Un solo campo manda.
  useEffect(() => {
    if (endMode !== "duration") return;
    if (!start) return;
    setEnd(endHHMM(start, duration));
  }, [endMode, start, duration]);

  const effectiveDuration =
    endMode === "duration"
      ? duration
      : durationFromRange(start, end) ?? duration;
  const daySlots = slots.filter((s) => s.dayIso === day);

  async function submit() {
    setLocalError(null);
    const built = buildDraft({
      kind,
      contactId,
      day,
      start,
      durationMinutes: effectiveDuration,
      title,
      location,
      notes,
      timezone,
    });
    if (!built.ok) {
      setLocalError(built.error);
      return;
    }
    await onSubmit(built.draft);
  }

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Nueva cita</h3>
          <p className="text-sm text-text-3">
            Tú la creas, sin esperar a que la IA cierre el hueco en el chat.
          </p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Tipo de registro">
          <Button
            size="sm"
            variant={kind === "session" ? "default" : "outline"}
            onClick={() => setKind("session")}
          >
            Cita
          </Button>
          <Button
            size="sm"
            variant={kind === "block" ? "default" : "outline"}
            onClick={() => setKind("block")}
          >
            Bloqueo
          </Button>
        </div>
      </div>

      {kind === "session" && (
        <ContactPicker value={contactId} onChange={setContactId} />
      )}

      {kind === "session" && (
        <div className="space-y-1.5">
          <Label htmlFor="cita-title">Motivo</Label>
          <Input
            id="cita-title"
            value={title}
            maxLength={255}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Revisión de propuesta"
          />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="cita-day">Fecha</Label>
          <Input
            id="cita-day"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cita-start">Inicio</Label>
          <Input
            id="cita-start"
            type="time"
            step={300}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-36"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex gap-1" role="group" aria-label="Cómo se fija el fin">
          <Button
            size="sm"
            variant={endMode === "duration" ? "default" : "outline"}
            onClick={() => setEndMode("duration")}
          >
            Duración
          </Button>
          <Button
            size="sm"
            variant={endMode === "end" ? "default" : "outline"}
            onClick={() => setEndMode("end")}
          >
            Hasta
          </Button>
        </div>
        {endMode === "duration" ? (
          <div className="space-y-1.5">
            <Label htmlFor="cita-duration">Minutos</Label>
            <Input
              id="cita-duration"
              type="number"
              min={5}
              max={600}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value) || 0)}
              className="w-24"
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="cita-end">Fin</Label>
            <Input
              id="cita-end"
              type="time"
              step={300}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-36"
            />
          </div>
        )}
        <span className="pb-2 text-xs text-text-3">
          {start && effectiveDuration >= 5
            ? `${hhmm(minutesOfHHMM(start) ?? 0)}–${endHHMM(
                start,
                effectiveDuration
              )} · ${effectiveDuration} min`
            : "Sin hora todavía"}
        </span>
      </div>

      {daySlots.length > 0 && (
        <div className="space-y-1.5">
          <Label>Huecos libres este día</Label>
          <div className="flex flex-wrap gap-1">
            {daySlots.slice(0, 16).map((s) => (
              <Button
                key={s.startUtc}
                size="sm"
                variant={start === s.time ? "default" : "outline"}
                onClick={() => setStart(s.time)}
              >
                {s.time}
              </Button>
            ))}
          </div>
        </div>
      )}

      {kind === "session" && (
        <div className="space-y-1.5">
          <Label htmlFor="cita-location">Lugar o modalidad</Label>
          <Input
            id="cita-location"
            list="cita-modalities"
            value={location}
            maxLength={255}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Videollamada, oficina, domicilio…"
          />
          <datalist id="cita-modalities">
            {MODALITIES.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="cita-notes">Notas</Label>
        <textarea
          id="cita-notes"
          value={notes}
          rows={2}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Qué se va a atender, con quién, qué hay que llevar…"
          className="w-full rounded-md border bg-card p-2 text-sm"
        />
      </div>

      {(localError || error) && (
        <p role="alert" className="text-sm text-destructive">
          {localError ?? error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void submit()} disabled={busy}>
          {busy
            ? "Guardando…"
            : kind === "session"
              ? "Agendar cita"
              : "Bloquear el rango"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cerrar
        </Button>
      </div>
      <p className="text-xs text-text-3">
        La hora se entiende en la zona del calendario ({timezone}); el servidor
        rechaza lo que cae fuera del horario configurado o ya está ocupado.
      </p>
    </section>
  );
}
