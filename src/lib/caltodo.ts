import { z } from "zod";

export const DEFAULT_TODO_SETTINGS = {
  workStartHour: 9, workEndHour: 17, timezone: "America/Mexico_City", defaultDuration: 60,
};

export const caltodoSettingsFields = z.object({
  workStartHour: z.number().int().min(0).max(23),
  workEndHour: z.number().int().min(1).max(24),
  timezone: z.string().max(64).refine((value) => {
    try { new Intl.DateTimeFormat("es", { timeZone: value }); return true; } catch { return false; }
  }, "Zona horaria inválida"),
  defaultDuration: z.number().int().min(15).max(480),
});

export const caltodoSettingsSchema = caltodoSettingsFields.superRefine((data, ctx) => {
  if (data.workEndHour <= data.workStartHour) {
    ctx.addIssue({ code: "custom", path: ["workEndHour"], message: "El fin debe ser posterior al inicio" });
  } else if (data.defaultDuration > (data.workEndHour - data.workStartHour) * 60) {
    ctx.addIssue({ code: "custom", path: ["defaultDuration"], message: "La duración debe caber en la jornada laboral" });
  }
});

export type CalTodoPreferences = z.infer<typeof caltodoSettingsFields>;
export type CalTodoItem = {
  id: string; title: string; details: string | null; urgent: boolean;
  duration: number | null; scheduledStart: Date | string | null;
  scheduledEnd: Date | string | null; completed: boolean;
  completedAt: Date | string | null; priority: number;
  contactId: string | null;
};

/** Calendar coordinates in the selected zone, independent of browser/server TZ. */
export function zonedParts(date: Date | string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(date));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}

export function zonedDisplayDate(date: Date | string, timeZone: string) {
  const p = zonedParts(date, timeZone);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute);
}
