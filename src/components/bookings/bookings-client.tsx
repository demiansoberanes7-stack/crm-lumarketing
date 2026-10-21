"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContactPicker } from "@/components/contact-picker";
import { useEvents } from "@/components/use-events";
import { LoadError } from "@/components/load-error";

/** 015 — Citas: lo agendado por el operador y por la IA, con sus acciones. */

type Booking = {
  id: string;
  kind: "session" | "block";
  status: "agendada" | "realizada" | "no_show" | "cancelada";
  source: "manual" | "ai";
  scheduledAtUtc: string;
  durationMinutes: number;
  date: string;
  time: string;
  weekday: string;
  contact: { id: string; name: string } | null;
  conversationId: string | null;
  connector: string | null;
  meetingLink: string | null;
  linkPending: boolean;
  isTest: boolean;
  notes: string | null;
};

type Slot = { startUtc: string; label: string };

/**
 * El instante de la cita manual, en UTC.
 *
 * Un hueco de la disponibilidad ya llega en UTC; la hora impuesta viene de un
 * `datetime-local`, que el navegador escribe SIN zona y hay que interpretar
 * como hora local del operador — si se mandara crudo, el servidor lo leería
 * como UTC y la cita quedaría 6 horas corrida.
 */
export function citaStartUtc(
  choice: "hueco" | "otra",
  slot: string,
  custom: string
): string | null {
  if (choice === "hueco") return slot || null;
  if (!custom) return null;
  const ms = Date.parse(custom);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const STATUS_LABEL: Record<Booking["status"], string> = {
  agendada: "Agendada",
  realizada: "Realizada",
  no_show: "No asistió",
  cancelada: "Cancelada",
};

export function BookingsClient() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [blockStart, setBlockStart] = useState("");
  const [blockMinutes, setBlockMinutes] = useState(60);
  // Alta manual de la cita: contacto, hora y nota. `slotChoice` decide si el
  // operador escoge un hueco de su horario o impone una hora concreta.
  const [citaContactId, setCitaContactId] = useState<string | null>(null);
  const [slotChoice, setSlotChoice] = useState<"hueco" | "otra">("hueco");
  const [citaSlot, setCitaSlot] = useState("");
  const [citaCustom, setCitaCustom] = useState("");
  const [citaNotes, setCitaNotes] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  // La agenda cambia también cuando agenda la IA: SSE mantiene la vista viva.
  useEvents({ onBookingUpdated: () => void refresh() });

  async function refresh() {
    const [list, avail] = await Promise.all([
      fetch("/api/bookings").catch(() => null),
      fetch("/api/calendar/availability").catch(() => null),
    ]);
    if (list?.ok) {
      const data = (await list.json()) as { bookings: Booking[] };
      setBookings(data.bookings);
      setListFailed(false);
    } else {
      setBookings([]);
      setListFailed(true);
    }
    if (avail?.ok) {
      const data = (await avail.json()) as { slots: Slot[] };
      setSlots(data.slots);
    }
  }

  async function act(id: string, body: unknown) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/bookings/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo completar la acción");
      return;
    }
    setRescheduling(null);
    await refresh();
  }

  async function createBlock() {
    if (!blockStart) return;
    setError(null);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "block",
        // El input datetime-local da hora local del navegador.
        startUtc: new Date(blockStart).toISOString(),
        durationMinutes: blockMinutes,
      }),
    }).catch(() => null);
    if (res?.status !== 201) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo bloquear ese rango");
      return;
    }
    setBlockStart("");
    await refresh();
  }

  /**
   * Alta manual. El servidor es el que valida: un horario fuera del configured
   * o ya ocupado vuelve `slot_taken`, así que el mensaje se deja ver tal cual
   * en vez de fingir que la cita se creó.
   */
  async function createCita() {
    const startUtc = citaStartUtc(slotChoice, citaSlot, citaCustom);
    if (!citaContactId || !startUtc) return;
    setCreating(true);
    setError(null);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "session",
        contactId: citaContactId,
        startUtc,
        notes: citaNotes.trim() || null,
      }),
    }).catch(() => null);
    setCreating(false);
    if (res?.status !== 201) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(
        data?.error?.message ??
          "No se pudo crear la cita. Si elegiste «otra hora», puede que ese instante esté fuera de tu horario o ya ocupado."
      );
      return;
    }
    setCitaSlot("");
    setCitaCustom("");
    setCitaNotes("");
    await refresh();
  }

  if (!bookings) return <p className="text-sm text-text-3">Cargando…</p>;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="space-y-3 rounded-md border p-4">
        <div>
          <h3 className="text-sm font-semibold">Nueva cita</h3>
          <p className="text-sm text-text-3">
            Tú la creas, sin esperar a que la IA cierre el hueco en el chat.
          </p>
        </div>

        <ContactPicker value={citaContactId} onChange={setCitaContactId} />

        <div className="space-y-1.5">
          <Label htmlFor="cita-mode">Hora</Label>
          <select
            id="cita-mode"
            value={slotChoice}
            onChange={(e) =>
              setSlotChoice(e.target.value === "otra" ? "otra" : "hueco")
            }
            className="w-full rounded-md border bg-card p-2 text-sm sm:w-64"
          >
            <option value="hueco">
              Un hueco libre de mi horario ({slots.length})
            </option>
            <option value="otra">Otra hora concreta</option>
          </select>
        </div>

        {slotChoice === "hueco" ? (
          slots.length === 0 ? (
            <p className="text-sm text-text-3">
              No hay huecos libres que ofrecer: configura tu horario en Ajustes
              → Calendario, o elige «Otra hora concreta».
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="cita-slot">Hueco</Label>
              <select
                id="cita-slot"
                value={citaSlot}
                onChange={(e) => setCitaSlot(e.target.value)}
                className="w-full rounded-md border bg-card p-2 text-sm sm:w-72"
              >
                <option value="">Elige un hueco…</option>
                {slots.map((s) => (
                  <option key={s.startUtc} value={s.startUtc}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="cita-custom">Inicio</Label>
            <Input
              id="cita-custom"
              type="datetime-local"
              value={citaCustom}
              onChange={(e) => setCitaCustom(e.target.value)}
              className="w-56"
            />
            <p className="text-xs text-text-3">
              Se respeta igual que las citas de la IA: si el horario está
              ocupado o cae fuera de tu jornada, el servidor la rechaza y te lo
              dice.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="cita-notes">Nota (opcional)</Label>
          <textarea
            id="cita-notes"
            value={citaNotes}
            onChange={(e) => setCitaNotes(e.target.value)}
            rows={2}
            placeholder="Qué se va a atender, dónde, con quién…"
            className="w-full rounded-md border bg-card p-2 text-sm"
          />
        </div>

        <Button
          onClick={createCita}
          disabled={
            creating ||
            !citaContactId ||
            citaStartUtc(slotChoice, citaSlot, citaCustom) === null
          }
        >
          {creating ? "Agendando…" : "Agendar cita"}
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Bloquear un rango</h3>
        <p className="text-sm text-text-3">
          Para compromisos que viven fuera del CRM: ese tiempo deja de
          ofrecerse.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="block-start">Inicio</Label>
            <Input
              id="block-start"
              type="datetime-local"
              value={blockStart}
              onChange={(e) => setBlockStart(e.target.value)}
              className="w-56"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="block-min">Minutos</Label>
            <Input
              id="block-min"
              type="number"
              min={10}
              max={480}
              value={blockMinutes}
              onChange={(e) => setBlockMinutes(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <Button
            variant="secondary"
            onClick={createBlock}
            disabled={!blockStart}
          >
            Bloquear
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          Citas <span className="text-text-3">({bookings.length})</span>
        </h3>
        {listFailed && bookings.length === 0 ? (
          <LoadError
            message="No se pudo leer la agenda."
            detail="«Todavía no hay nada agendado» sería otra cosa: la lista de citas no llegó. Reintenta y, si sigue, avisa."
            onRetry={() => void refresh()}
          />
        ) : (
          bookings.length === 0 && (
            <p className="text-sm text-text-3">
              Todavía no hay nada agendado. Crea la primera arriba con «Nueva
              cita», o configura tu horario en Ajustes → Calendario para que la
              IA empiece a cerrar huecos sola.
            </p>
          )
        )}
        <ul className="divide-y rounded-md border">
          {bookings.map((b) => (
            <li key={b.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {b.weekday} {b.date} · {b.time}
                </span>
                <span className="text-xs text-text-3">
                  {b.durationMinutes} min
                </span>
                <Badge
                  variant={b.status === "cancelada" ? "secondary" : "default"}
                >
                  {STATUS_LABEL[b.status]}
                </Badge>
                {b.kind === "block" ? (
                  <Badge variant="secondary">Bloqueo</Badge>
                ) : (
                  <Badge variant="secondary">
                    {b.source === "ai" ? "Agendó la IA" : "Manual"}
                  </Badge>
                )}
                {b.isTest && <Badge variant="secondary">Prueba</Badge>}
                {b.linkPending && b.status !== "cancelada" && (
                  <Badge variant="secondary">Sin enlace</Badge>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-text-3">
                {b.contact && <span>{b.contact.name}</span>}
                {b.meetingLink && (
                  <a
                    href={b.meetingLink}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-brand-text hover:underline"
                  >
                    Enlace de la reunión
                  </a>
                )}
                {b.notes && <span>{b.notes}</span>}
              </div>

              {/* El proveedor falló al crear la reunión. La cita existe; lo
                  único que falta es el enlace, y se reintenta desde aquí — sin
                  esto, un hipo del proveedor sería una pérdida silenciosa. */}
              {b.linkPending && b.status !== "cancelada" && (
                <div className="flex flex-wrap items-center gap-2 rounded-sm bg-subtle p-2">
                  <span className="text-sm text-text-2">
                    Esta cita quedó sin enlace: el proveedor no respondió.
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === b.id}
                    onClick={() => act(b.id, { action: "retry_link" })}
                  >
                    Reintentar enlace
                  </Button>
                </div>
              )}

              {b.status === "agendada" && (
                <div className="flex flex-wrap gap-2">
                  {/* Un bloqueo no se "realiza" ni tiene quien falte: solo se
                      mueve o se quita. */}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === b.id}
                    onClick={() =>
                      setRescheduling((r) => (r === b.id ? null : b.id))
                    }
                  >
                    Reprogramar
                  </Button>
                  {b.kind === "session" && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy === b.id}
                        onClick={() =>
                          act(b.id, { action: "status", status: "realizada" })
                        }
                      >
                        Realizada
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy === b.id}
                        onClick={() =>
                          act(b.id, { action: "status", status: "no_show" })
                        }
                      >
                        No asistió
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === b.id}
                    onClick={() => act(b.id, { action: "cancel" })}
                  >
                    {b.kind === "block" ? "Quitar bloqueo" : "Cancelar"}
                  </Button>
                </div>
              )}

              {rescheduling === b.id && (
                <div className="space-y-1 rounded-sm bg-subtle p-2">
                  {slots.length === 0 && (
                    <p className="text-sm text-text-3">
                      No hay huecos libres para mover esta cita.
                    </p>
                  )}
                  {slots.slice(0, 12).map((s) => (
                    <button
                      key={s.startUtc}
                      type="button"
                      disabled={busy === b.id}
                      onClick={() =>
                        act(b.id, {
                          action: "reschedule",
                          startUtc: s.startUtc,
                        })
                      }
                      className="block w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
