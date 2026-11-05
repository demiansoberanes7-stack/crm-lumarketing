"use client";

import { cn } from "@/lib/utils";
import {
  clipToDay,
  groupByDay,
  hoursRange,
  hhmm,
  monthDaysISO,
  weekDaysISO,
  weekdayIndexOf,
  WEEKDAY_LABELS,
  type AgendaView,
  type BlockTone,
} from "@/lib/agenda/view-model";

/**
 * La rejilla del calendario, extraída del `CalendarView` de Pendientes y
 * parametrizada: recibe BLOQUES con su inicio y su fin en minutos de pared, no
 * tareas de un dominio concreto. Así la pueden usar Citas hoy y cualquier otra
 * vista mañana sin reescribir la geometría.
 *
 * Todo lo que entra aquí ya viene convertido por el servidor
 * (`dayIso`/`startMinutes`/`endMinutes` en la zona de quien mira). El componente
 * NO hace aritmética de zona horaria: es la trampa que desplaza las citas seis
 * horas cuando el navegador del operador no está en la zona del negocio.
 */

export type GridBlock = {
  id: string;
  dayIso: string;
  startMinutes: number;
  endMinutes: number;
  label: string;
  sub?: string;
  tone: BlockTone;
};

export type GridFreeSlot = {
  id: string;
  dayIso: string;
  startMinutes: number;
  endMinutes: number;
};

/** 56 px por hora: caben dos renglones de texto en la vista semanal. */
const HOUR_PX = 56;

const TONE_CLASS: Record<BlockTone, string> = {
  agendada: "bg-brand-tint border-brand-soft text-foreground",
  realizada: "bg-success-tint border-success-soft text-success-text",
  no_show: "bg-warning-tint border-warning-soft text-warning-text",
  cancelada: "bg-subtle border-border text-text-3 line-through",
  bloqueo: "bg-danger-tint border-danger-soft text-danger-text",
  libre: "bg-card border-brand-soft text-brand-text",
};

type GridProps = {
  /** Día ISO (YYYY-MM-DD) alrededor del cual se pinta, ya en la zona del negocio. */
  anchor: string;
  today: string;
  blocks: GridBlock[];
  free: GridFreeSlot[];
  /** Seleccionar una cita existente. */
  onSelect: (id: string) => void;
  /** Empezar una cita en el hueco (o el día) que se pinchó. */
  onPick: (dayIso: string, startMinutes: number | null) => void;
  selectedId?: string | null;
  className?: string;
};

export function CalendarGrid({ view, ...props }: GridProps & { view: AgendaView }) {
  if (view === "month") return <MonthGrid {...props} />;
  return (
    <TimeGrid
      {...props}
      days={view === "week" ? weekDaysISO(props.anchor) : [props.anchor]}
    />
  );
}

/* ------------------------------------------------------------------ Mes */

function MonthGrid({
  anchor,
  today,
  blocks,
  free,
  onSelect,
  onPick,
  selectedId,
  className,
}: GridProps) {
  const days = monthDaysISO(anchor);
  const byDay = groupByDay(blocks);
  const freeByDay = groupByDay(free);
  const month = anchor.slice(0, 7);

  return (
    <div className={cn("overflow-x-auto", className)}>
      <div className="grid min-w-[640px] grid-cols-7 rounded-md border-l border-t text-sm">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="border-b border-r bg-subtle p-2 text-center text-xs font-medium text-text-3"
          >
            {label}
          </div>
        ))}
        {days.map((day) => {
          const items = byDay[day] ?? [];
          const openSlots = freeByDay[day] ?? [];
          const outside = day.slice(0, 7) !== month;
          return (
            <div
              key={day}
              className={cn(
                "min-h-[112px] border-b border-r p-1 align-top",
                outside ? "bg-subtle text-text-3" : "bg-card",
                day === today && "ring-1 ring-inset ring-brand-soft"
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-1">
                <button
                  type="button"
                  onClick={() => onPick(day, null)}
                  aria-label={`Agendar algo el ${day}`}
                  className={cn(
                    "rounded-sm px-1 text-xs font-semibold hover:bg-accent",
                    day === today ? "text-brand" : "text-text-2"
                  )}
                >
                  {Number(day.slice(8, 10))}
                </button>
                {openSlots.length > 0 && (
                  <span className="text-[11px] text-brand-text">
                    {openSlots.length} libres
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {items.slice(0, 3).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onSelect(b.id)}
                    className={cn(
                      "block w-full truncate rounded-sm border px-1 py-0.5 text-left text-[11px]",
                      TONE_CLASS[b.tone],
                      selectedId === b.id && "ring-1 ring-brand"
                    )}
                    title={`${hhmm(b.startMinutes)} ${b.label}`}
                  >
                    {hhmm(b.startMinutes)} {b.label}
                  </button>
                ))}
                {items.length > 3 && (
                  <span className="block px-1 text-[11px] text-text-3">
                    +{items.length - 3} más
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Semana / Día */

function TimeGrid({
  today,
  blocks,
  free,
  onSelect,
  onPick,
  selectedId,
  className,
  days,
}: GridProps & { days: string[] }) {
  const { hours } = hoursRange(
    [...blocks, ...free].map((b) => ({
      startMinutes: b.startMinutes,
      endMinutes: b.endMinutes,
    })),
    [8, 20]
  );
  const dayStart = (hours[0] ?? 8) * 60;
  const heightPx = hours.length * HOUR_PX;
  const byDay = groupByDay(blocks);
  const freeByDay = groupByDay(free);
  const top = (minutes: number) =>
    ((Math.max(dayStart, Math.min(1440, minutes)) - dayStart) / 60) * HOUR_PX;

  return (
    <div className={cn("overflow-x-auto", className)}>
      <div
        className="grid rounded-md border-l border-t text-sm"
        style={{
          gridTemplateColumns: `56px repeat(${days.length}, minmax(${
            days.length === 1 ? "0" : "120px"
          }, 1fr))`,
          minWidth: days.length === 1 ? undefined : `${56 + days.length * 120}px`,
        }}
      >
        <div className="bg-subtle">
          {/* Spacer de la cabecera: la misma altura que la fila de días de las
              columnas, para que las etiquetas de hora caigan EN SU renglón. Sin
              esto, la columna de horas sube ~50px más que las rejillas. */}
          <div className="h-14 border-b" aria-hidden="true" />
          {hours.map((h) => (
            <div
              key={h}
              style={{ height: HOUR_PX }}
              className="border-b px-2 pt-1 text-xs text-text-3"
            >
              {hhmm(h * 60)}
            </div>
          ))}
        </div>

        {days.map((day) => {
          const dayBlocks = byDay[day] ?? [];
          const dayFree = freeByDay[day] ?? [];
          const weekday = WEEKDAY_LABELS[weekdayIndexOf(day)] ?? "";
          return (
            <div key={day} className="border-l">
              <div
                className={cn(
                  "flex h-14 flex-col items-center justify-center border-b text-center",
                  day === today ? "bg-brand-tint" : "bg-subtle"
                )}
              >
                <div className="text-xs text-text-3">{weekday}</div>
                <div
                  className={cn(
                    "text-sm font-medium",
                    day === today ? "text-brand" : ""
                  )}
                >
                  {Number(day.slice(8, 10))}
                </div>
              </div>

              <div className="relative" style={{ height: heightPx }}>
                {/* Un botón por hora: agendar en el hueco que se ve vacío. */}
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => onPick(day, h * 60)}
                    aria-label={`Agendar ${weekday} ${day.slice(8, 10)} a las ${hhmm(
                      h * 60
                    )}`}
                    style={{ top: (h - dayStart / 60) * HOUR_PX, height: HOUR_PX }}
                    className="absolute inset-x-0 border-b hover:bg-accent"
                  />
                ))}

                {/* Los huecos libres van bajo las citas: se ven donde no hay nada
                    ocupado y queda dónde pinchar para agendar. */}
                {dayFree.map((slot) => {
                  const clip = clipToDay(slot);
                  if (!clip) return null;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => onPick(day, slot.startMinutes)}
                      className={cn(
                        "absolute inset-x-0.5 overflow-hidden rounded-sm border border-dashed px-1 text-left text-[11px]",
                        TONE_CLASS.libre
                      )}
                      style={{
                        top: top(slot.startMinutes),
                        height: Math.max(14, (clip.heightMinutes / 60) * HOUR_PX - 2),
                      }}
                      title={`Libre a las ${hhmm(slot.startMinutes)}`}
                    >
                      {hhmm(slot.startMinutes)}
                    </button>
                  );
                })}

                {dayBlocks.map((b) => {
                  const clip = clipToDay(b);
                  if (!clip) return null;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => onSelect(b.id)}
                      className={cn(
                        "absolute inset-x-0.5 overflow-hidden rounded-md border px-1 py-0.5 text-left text-xs",
                        TONE_CLASS[b.tone],
                        selectedId === b.id && "ring-2 ring-brand"
                      )}
                      style={{
                        top: top(b.startMinutes),
                        height: Math.max(
                          18,
                          (clip.heightMinutes / 60) * HOUR_PX - 2
                        ),
                      }}
                      title={`${hhmm(b.startMinutes)}–${hhmm(b.endMinutes)} ${b.label}`}
                    >
                      <span className="block truncate font-medium">{b.label}</span>
                      <span className="block truncate text-[11px] opacity-80">
                        {hhmm(b.startMinutes)}
                        {b.sub ? ` · ${b.sub}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
