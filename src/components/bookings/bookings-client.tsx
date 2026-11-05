"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/load-error";
import { useEvents } from "@/components/use-events";
import {
  rangeForView,
  rangeLabel,
  shiftISO,
  toneFor,
  type AgendaView,
} from "@/lib/agenda/view-model";
import { CalendarGrid, type GridBlock, type GridFreeSlot } from "@/components/agenda/calendar-grid";
import {
  AgendaForm,
  type AgendaPreset,
  type NewBookingDraft,
} from "@/components/agenda/agenda-form";
import { BookingDetail } from "@/components/agenda/booking-detail";
import { STATUS_LABEL } from "@/components/agenda/labels";
import type { BookingDto, SlotDto } from "@/lib/agenda/dto";

/**
 * 015 · A3 — Citas como calendario, no como lista.
 *
 * La pantalla siempre fue la lista de `listBookings`; aquí manda la rejilla y la
 * lista pasa a ser el resumen del rango. Todo lo que se lee y se escribe sigue
 * siendo el mismo contrato de `/api/bookings` y `/api/calendar/availability`:
 * esta pieza solo los junta, y **refresca lista y disponibilidad después de cada
 * operación** — si no, el hueco que acabas de llenar seguiría ofreciéndose y la
 * siguiente cita nacería encimada.
 *
 * El fetch vive aquí y en ningún hijo: un solo lugar que sepa qué es «guardar» y
 * qué es «volver a leer» es lo que impide que tres componentes distintos crean
 * que refrescarles toca a ellos.
 */

const VIEWS: { id: AgendaView; label: string }[] = [
  { id: "month", label: "Mes" },
  { id: "week", label: "Semana" },
  { id: "day", label: "Día" },
];

type ErrorResponse = {
  error?: { code?: string; message?: string };
  slots?: SlotDto[];
};

export function BookingsClient() {
  const [view, setView] = useState<AgendaView>("month");
  // Día ISO alrededor del cual se pinta. Se siembra con la fecha del navegador
  // y se corrige con el `today` que devuelve el servidor (zona del negocio).
  const [anchor, setAnchor] = useState(() => new Date().toISOString().slice(0, 10));
  const [timezone, setTimezone] = useState("America/Mexico_City");
  const [today, setToday] = useState("");
  const [bookings, setBookings] = useState<BookingDto[] | null>(null);
  const [slots, setSlots] = useState<SlotDto[]>([]);
  const [listFailed, setListFailed] = useState(false);
  const [availFailed, setAvailFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preset, setPreset] = useState<AgendaPreset>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // true solo cuando el operador movió el rango a mano: es lo que impide que el
  // `today` del servidor le devuelva la vista a agosto mientras mira octubre.
  const touched = useRef(false);

  const refresh = useCallback(async () => {
    const { from, to } = rangeForView(anchor, view);
    const query = `from=${from}&to=${to}`;
    const [listRes, availRes] = await Promise.all([
      fetch(`/api/bookings?${query}`).catch(() => null),
      fetch(`/api/calendar/availability?${query}`).catch(() => null),
    ]);

    if (listRes?.ok) {
      const data = (await listRes.json().catch(() => null)) as {
        bookings?: BookingDto[];
        timezone?: string;
        today?: string;
      } | null;
      setBookings(data?.bookings ?? []);
      setListFailed(false);
      if (data?.timezone) setTimezone(data.timezone);
      if (data?.today) {
        setToday(data.today);
        if (!touched.current && data.today !== anchor) setAnchor(data.today);
      }
    } else {
      // Un 500 no es «no hay citas»: se dice, y la rejilla no se llena de vacíos.
      setBookings([]);
      setListFailed(true);
    }

    if (availRes?.ok) {
      const data = (await availRes.json().catch(() => null)) as {
        slots?: SlotDto[];
      } | null;
      setSlots(data?.slots ?? []);
      setAvailFailed(false);
    } else {
      setSlots([]);
      setAvailFailed(true);
    }
  }, [anchor, view]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // La agenda también la mueve la IA: SSE mantiene la vista viva.
  useEvents({ onBookingUpdated: () => void refresh() });

  const selected = bookings?.find((b) => b.id === selectedId) ?? null;

  const gridBlocks: GridBlock[] = (bookings ?? []).map((b) => ({
    id: b.id,
    dayIso: b.dayIso,
    startMinutes: b.startMinutes,
    endMinutes: b.endMinutes,
    label: b.title ?? (b.kind === "block" ? "Bloqueo" : b.contact?.name ?? "Cita"),
    sub: b.contact && b.title ? b.contact.name : undefined,
    tone: toneFor(b),
  }));

  const gridFree: GridFreeSlot[] = slots.map((s) => ({
    id: s.startUtc,
    dayIso: s.dayIso,
    startMinutes: s.startMinutes,
    endMinutes: s.endMinutes,
  }));

  /** Un `PATCH` sobre la cita seleccionada. Devuelve si hay que refrescar. */
  async function act(body: Record<string, unknown>): Promise<boolean> {
    if (!selected) return false;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/bookings/${selected.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    const data = res ? ((await res.json().catch(() => null)) as ErrorResponse | null) : null;
    if (!res?.ok) {
      setError(data?.error?.message ?? "No se pudo completar la acción.");
      return false;
    }
    if (body.action === "cancel") setSelectedId(null);
    await refresh();
    return true;
  }

  /** Alta. El 201 es contrato; cualquier otro código se muestra tal cual. */
  async function create(draft: NewBookingDraft) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    }).catch(() => null);
    setBusy(false);

    if (res?.status !== 201) {
      const data = res
        ? ((await res.json().catch(() => null)) as ErrorResponse | null)
        : null;
      setError(
        data?.error?.message ??
          "No se pudo crear. Si la hora está fuera de tu horario o el instante ya está ocupado, el servidor lo dice arriba."
      );
      // `slot_taken` viene con alternativas frescas: se pintan de inmediato en
      // vez de obligar a volver a consultar la disponibilidad.
      if (data?.slots?.length) setSlots(data.slots);
      return;
    }

    const data = (await res.json().catch(() => null)) as {
      booking?: { id?: string };
      bookingId?: string;
    } | null;
    const created = data?.booking?.id ?? data?.bookingId ?? null;
    setPreset(null);
    setFormOpen(false);
    setSelectedId(created);
    await refresh();
  }

  function pick(dayIso: string, startMinutes: number | null) {
    setPreset({ dayIso, startMinutes });
    setFormOpen(true);
    setSelectedId(null);
    setError(null);
  }

  const ordered = [...(bookings ?? [])].sort(
    (a, b) => Date.parse(a.scheduledAtUtc) - Date.parse(b.scheduledAtUtc)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            aria-label="Periodo anterior"
            onClick={() => {
              touched.current = true;
              setAnchor((a) => shiftISO(a, view, -1));
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              touched.current = false;
              setAnchor(today || anchor);
            }}
          >
            Hoy
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label="Periodo siguiente"
            onClick={() => {
              touched.current = true;
              setAnchor((a) => shiftISO(a, view, 1));
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-sm font-medium text-text-2">
            {rangeLabel(anchor, view)}
          </span>
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Vista">
          {VIEWS.map((v) => (
            <Button
              key={v.id}
              size="sm"
              variant={view === v.id ? "default" : "outline"}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </Button>
          ))}
          <Button size="sm" onClick={() => setFormOpen((o) => !o)}>
            {formOpen ? "Ocultar alta" : "Nueva cita"}
          </Button>
        </div>
      </div>

      <p className="text-xs text-text-3">
        Zona del calendario: {timezone.replace(/_/g, " ")} ·{" "}
        {slots.length > 0
          ? `${slots.length} huecos libres en el rango`
          : availFailed
            ? "no se pudo leer la disponibilidad"
            : "sin huecos libres en el rango"}
      </p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {!bookings && <p className="text-sm text-text-3">Cargando…</p>}
          {listFailed && bookings?.length === 0 ? (
            <LoadError
              message="No se pudo leer la agenda."
              detail="«Todavía no hay nada agendado» sería otra cosa: la lista de citas no llegó. Reintenta y, si sigue, avisa."
              onRetry={() => void refresh()}
            />
          ) : (
            bookings && (
              <CalendarGrid
                view={view}
                anchor={anchor}
                today={today || anchor}
                blocks={gridBlocks}
                free={gridFree}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setFormOpen(false);
                  setError(null);
                }}
                onPick={pick}
              />
            )
          )}

          {formOpen && (
            <AgendaForm
              timezone={timezone}
              preset={preset}
              slots={slots}
              busy={busy}
              error={error}
              onCancel={() => {
                setFormOpen(false);
                setPreset(null);
                setError(null);
              }}
              onSubmit={create}
            />
          )}

          {bookings && bookings.length === 0 && !listFailed && (
            <p className="text-sm text-text-3">
              Este rango está vacío. Pincha un día o un hueco para agendar ahí, o
              configura tu horario en Ajustes → Calendario para que la IA empiece
              a cerrar huecos sola.
            </p>
          )}

          {ordered.length > 0 && (
            <ul className="divide-y rounded-md border">
              {ordered.slice(0, 60).map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(b.id)}
                  className={`flex w-full flex-wrap items-center gap-2 p-2 text-left text-sm hover:bg-accent ${
                    selectedId === b.id ? "bg-accent" : ""
                  }`}
                >
                  <span className="text-text-3">
                    {b.weekday} {b.date} · {b.time}
                  </span>
                  <span className="font-medium">
                    {b.title ?? (b.kind === "block" ? "Bloqueo" : "Cita")}
                  </span>
                  {b.contact && (
                    <span className="text-text-2">{b.contact.name}</span>
                  )}
                  <Badge
                    variant={
                      b.status === "cancelada"
                        ? "secondary"
                        : b.status === "realizada"
                          ? "success"
                          : "default"
                    }
                  >
                    {STATUS_LABEL[b.status]}
                  </Badge>
                  <span className="text-xs text-text-3">
                    {b.durationMinutes} min
                  </span>
                  {b.assigneeName && (
                    <span className="text-xs text-text-3">
                      {b.assigneeName}
                    </span>
                  )}
                </button>
              </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          {selected ? (
            <BookingDetail
              key={selected.id}
              booking={selected}
              timezone={timezone}
              slots={slots}
              busy={busy}
              onAct={act}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <aside className="rounded-md border border-dashed p-4 text-sm text-text-3">
              Selecciona una cita en la rejilla para verla y editarla. Pincha un
              hueco libre para agendar ahí.
            </aside>
          )}
          {availFailed && (
            <LoadError
              message="No se pudo leer la disponibilidad."
              detail="La rejilla no puede pintar huecos libres: no es que no tengas, es que la consulta falló. Reintenta."
              onRetry={() => void refresh()}
            />
          )}
        </div>
      </div>
    </div>
  );
}
