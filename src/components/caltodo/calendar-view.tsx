"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CalendarDays, Clock } from "lucide-react";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, addWeeks, subWeeks, addDays, subDays, startOfDay, isToday } from "date-fns";
import { es } from "date-fns/locale";

type Task = { id: string; title: string; scheduledStart: Date | null; scheduledEnd: Date | null; completed: boolean; details: string | null };
type Settings = { workStartHour: number; workEndHour: number } | null;

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function CalendarView({ tasks, settings }: { tasks: Task[]; settings: Settings }) {
  const [mode, setMode] = useState<"week" | "day">("week");
  const [current, setCurrent] = useState(new Date());

  const scheduled = tasks.filter((t) => !t.completed && t.scheduledStart);
  const ws = settings?.workStartHour ?? 9;
  const we = settings?.workEndHour ?? 17;
  const hours = HOURS.filter((h) => h >= ws - 1 && h <= we + 1);

  const weekStart = startOfWeek(current, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(current, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const tasksForDay = (day: Date) => scheduled.filter((t) => t.scheduledStart && isSameDay(new Date(t.scheduledStart), day));

  const position = (t: Task) => {
    if (!t.scheduledStart || !t.scheduledEnd) return null;
    const s = new Date(t.scheduledStart), e = new Date(t.scheduledEnd);
    const sh = s.getHours() + s.getMinutes() / 60, eh = e.getHours() + e.getMinutes() / 60;
    const top = ((sh - (hours[0] ?? 0)) / hours.length) * 100;
    const height = ((eh - sh) / hours.length) * 100;
    return { top: `${top}%`, height: `${Math.max(height, 3)}%` };
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-lg font-semibold flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Calendario</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant={mode === "day" ? "default" : "outline"} size="sm" onClick={() => setMode("day")}>Día</Button>
            <Button variant={mode === "week" ? "default" : "outline"} size="sm" onClick={() => setMode("week")}>Semana</Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 mt-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => mode === "week" ? setCurrent((d) => subWeeks(d, 1)) : setCurrent((d) => subDays(d, 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setCurrent(new Date())}>Hoy</Button>
            <Button variant="outline" size="icon" onClick={() => mode === "week" ? setCurrent((d) => addWeeks(d, 1)) : setCurrent((d) => addDays(d, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <span className="text-sm font-medium text-text-2">
            {mode === "week" ? `${format(weekStart, "MMM d", { locale: es })} – ${format(weekEnd, "MMM d, yyyy", { locale: es })}` : format(current, "EEEE, d 'de' MMMM, yyyy", { locale: es })}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {mode === "week" ? (
          <div className="grid grid-cols-8 border rounded-md overflow-hidden text-sm">
            <div className="bg-subtle">
              <div className="h-12 border-b" />
              {hours.map((h) => <div key={h} className="h-16 border-b text-xs text-text-3 px-2 pt-1">{format(new Date().setHours(h, 0), "ha")}</div>)}
            </div>
            {weekDays.map((day) => {
              const dayTasks = tasksForDay(day);
              const today = isToday(day);
              return (
                <div key={day.toISOString()} className="border-l relative">
                  <div className={`h-12 border-b p-2 text-center ${today ? "bg-brand/10" : "bg-subtle/50"}`}>
                    <div className="text-xs text-text-3">{format(day, "EEE", { locale: es })}</div>
                    <div className={`text-sm font-medium ${today ? "text-brand" : ""}`}>{format(day, "d")}</div>
                  </div>
                  <div className="relative" style={{ height: `${hours.length * 64}px` }}>
                    {hours.map((h) => <div key={h} className={`h-16 border-b ${h >= ws && h < we ? "" : "bg-subtle/50"}`} />)}
                    {dayTasks.map((t) => { const pos = position(t); return pos ? (
                      <div key={t.id} className="absolute left-0.5 right-0.5 rounded-md p-1 text-xs overflow-hidden bg-brand/20 border border-brand/40" style={pos}>
                        <div className="font-medium truncate">{t.title}</div>
                        {t.scheduledStart && <div className="text-text-3 truncate">{format(new Date(t.scheduledStart), "h:mm a")}</div>}
                      </div>
                    ) : null; })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 border rounded-md overflow-hidden text-sm">
            <div className="bg-subtle">
              {hours.map((h) => <div key={h} className="h-20 border-b text-xs text-text-3 px-2 pt-1">{format(new Date().setHours(h, 0), "h:mm a")}</div>)}
            </div>
            <div className="border-l relative">
              <div className="relative" style={{ height: `${hours.length * 80}px` }}>
                {hours.map((h) => <div key={h} className={`h-20 border-b ${h >= ws && h < we ? "" : "bg-subtle/50"}`} />)}
                {tasksForDay(startOfDay(current)).map((t) => { const pos = position(t); return pos ? (
                  <div key={t.id} className="absolute left-1 right-1 rounded-md p-2 overflow-hidden bg-brand/20 border border-brand/40" style={pos}>
                    <div className="font-medium">{t.title}</div>
                    {t.scheduledStart && t.scheduledEnd && <div className="text-xs text-text-3 flex items-center gap-1 mt-1"><Clock className="h-3 w-3" />{format(new Date(t.scheduledStart), "h:mm a")} – {format(new Date(t.scheduledEnd), "h:mm a")}</div>}
                    {t.details && <p className="text-xs text-text-3 mt-1 line-clamp-2">{t.details}</p>}
                  </div>
                ) : null; })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
