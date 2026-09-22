import type { CalTodoTask, CalTodoSettings } from "./store";

export function findNextFreeSlot(
  tasks: CalTodoTask[],
  settings: CalTodoSettings | null,
  durationMinutes: number,
  startFrom: Date = new Date()
): { start: Date; end: Date } | null {
  const workStart = settings?.workStartHour ?? 9;
  const workEnd = settings?.workEndHour ?? 17;
  const slotMs = durationMinutes * 60 * 1000;

  const scheduled = tasks
    .filter((t) => !t.completed && t.scheduledStart && t.scheduledEnd)
    .map((t) => ({
      start: new Date(t.scheduledStart!).getTime(),
      end: new Date(t.scheduledEnd!).getTime(),
    }))
    .sort((a, b) => a.start - b.start);

  const cursor = new Date(startFrom);
  const maxDate = new Date(startFrom.getTime() + 90 * 24 * 60 * 60 * 1000);

  while (cursor < maxDate) {
    const hour = cursor.getHours();
    if (hour >= workStart && hour < workEnd) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(cursor.getTime() + slotMs);
      const slotEndHour = slotEnd.getHours() + slotEnd.getMinutes() / 60;
      if (slotEndHour <= workEnd) {
        const overlaps = scheduled.some((s) => slotStart.getTime() < s.end && slotEnd.getTime() > s.start);
        if (!overlaps) return { start: slotStart, end: slotEnd };
      }
    }
    cursor.setMinutes(cursor.getMinutes() + 15);
  }
  return null;
}

export function rescheduleAll(
  tasks: CalTodoTask[],
  settings: CalTodoSettings | null
): { id: string; scheduledStart: Date; scheduledEnd: Date }[] {
  const incomplete = tasks
    .filter((t) => !t.completed)
    .sort((a, b) => a.priority - b.priority);

  const result: { id: string; scheduledStart: Date; scheduledEnd: Date }[] = [];
  const now = new Date();

  for (const task of incomplete) {
    const duration = task.duration ?? settings?.defaultDuration ?? 60;
    const after = result.length > 0 ? result[result.length - 1]!.scheduledEnd : now;
    const existing = result.map((r) => ({ id: r.id, scheduledStart: r.scheduledStart, scheduledEnd: r.scheduledEnd } as unknown as CalTodoTask));
    const slot = findNextFreeSlot(
      [...tasks.filter((t) => t.id !== task.id), ...existing],
      settings,
      duration,
      after
    );
    if (slot) {
      result.push({ id: task.id, scheduledStart: slot.start, scheduledEnd: slot.end });
    }
  }
  return result;
}
