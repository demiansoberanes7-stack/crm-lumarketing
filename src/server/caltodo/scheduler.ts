import { DEFAULT_TODO_SETTINGS, type CalTodoItem, type CalTodoPreferences } from "@/lib/caltodo";

export function findNextFreeSlot(
  tasks: CalTodoItem[],
  settings: CalTodoPreferences | null,
  durationMinutes: number,
  startFrom: Date = new Date()
): { start: Date; end: Date } | null {
  const { workStartHour, workEndHour, timezone } = settings ?? DEFAULT_TODO_SETTINGS;
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > (workEndHour - workStartHour) * 60) return null;
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const coordinates = (ms: number) => {
    const parts = format.formatToParts(ms);
    const value = (key: string) => parts.find((p) => p.type === key)!.value;
    return { day: `${value("year")}-${value("month")}-${value("day")}`, minute: Number(value("hour")) * 60 + Number(value("minute")) };
  };
  const scheduled = tasks.filter((t) => !t.completed && t.scheduledStart && t.scheduledEnd)
    .map((t) => ({ start: new Date(t.scheduledStart!).getTime(), end: new Date(t.scheduledEnd!).getTime() }));
  const step = 15 * 60_000;
  const duration = durationMinutes * 60_000;
  const limit = startFrom.getTime() + 90 * 86_400_000;
  // UTC iteration handles missing/repeated hours at DST transitions. Check the
  // last instant of the slot so an end exactly at 24:00 belongs to this day.
  for (let cursor = Math.ceil(startFrom.getTime() / step) * step; cursor < limit; cursor += step) {
    const start = coordinates(cursor);
    if (start.minute < workStartHour * 60 || start.minute >= workEndHour * 60) continue;
    const end = coordinates(cursor + duration - 1);
    if (end.day !== start.day || end.minute >= workEndHour * 60) continue;
    if (scheduled.some((s) => cursor < s.end && cursor + duration > s.start)) continue;
    return { start: new Date(cursor), end: new Date(cursor + duration) };
  }
  return null;
}

export function rescheduleAll(tasks: CalTodoItem[], settings: CalTodoPreferences | null, now = new Date()) {
  const pending = tasks.filter((t) => !t.completed).sort((a, b) => a.priority - b.priority);
  const planned: CalTodoItem[] = [];
  for (const task of pending) {
    const slot = findNextFreeSlot(planned, settings, task.duration ?? settings?.defaultDuration ?? 60, now);
    if (slot) planned.push({ ...task, scheduledStart: slot.start, scheduledEnd: slot.end });
  }
  return planned.map((t) => ({ id: t.id, scheduledStart: new Date(t.scheduledStart!), scheduledEnd: new Date(t.scheduledEnd!) }));
}
