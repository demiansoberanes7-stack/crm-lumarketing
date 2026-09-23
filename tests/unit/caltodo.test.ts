import { describe, expect, it } from "vitest";
import { caltodoSettingsSchema, DEFAULT_TODO_SETTINGS, zonedParts, type CalTodoItem } from "@/lib/caltodo";
import { findNextFreeSlot, rescheduleAll } from "@/server/caltodo/scheduler";

const settings = DEFAULT_TODO_SETTINGS;
const task = (id: string, start: string, end: string, priority = 0): CalTodoItem => ({
  id, title: id, details: null, urgent: false, duration: 60, scheduledStart: start,
  scheduledEnd: end, completed: false, completedAt: null, priority, contactId: null, projectId: null,
});

describe("CalTodo scheduling and settings regressions", () => {
  it("schedules at 09:00 Mexico City instead of the server's 09:00 UTC", () => {
    const slot = findNextFreeSlot([], settings, 60, new Date("2026-09-22T10:00:00Z"));
    expect(slot?.start.toISOString()).toBe("2026-09-22T15:00:00.000Z");
  });
  it("rounds up, skips occupied slots and ignores completed tasks", () => {
    const tasks = [task("a", "2026-09-22T15:00:00Z", "2026-09-22T16:00:00Z"), { ...task("b", "2026-09-22T16:00:00Z", "2026-09-22T17:00:00Z"), completed: true }];
    expect(findNextFreeSlot(tasks, settings, 60, new Date("2026-09-22T15:02:15Z"))?.start.toISOString()).toBe("2026-09-22T16:00:00.000Z");
  });
  it("moves to the next day rather than overflowing the workday", () => {
    expect(findNextFreeSlot([], settings, 120, new Date("2026-09-22T22:00:00Z"))?.start.toISOString()).toBe("2026-09-23T15:00:00.000Z");
    expect(findNextFreeSlot([], settings, 600)).toBeNull();
  });
  it("permits a task ending exactly at midnight for a 24:00 work end", () => {
    const slot = findNextFreeSlot([], { ...settings, workStartHour: 22, workEndHour: 24 }, 60, new Date("2026-09-23T05:00:00Z"));
    expect(slot?.end.toISOString()).toBe("2026-09-23T06:00:00.000Z");
  });
  it("observes DST in the selected zone", () => {
    const ny = { ...settings, timezone: "America/New_York" };
    expect(findNextFreeSlot([], ny, 60, new Date("2026-03-07T00:00:00Z"))?.start.toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(findNextFreeSlot([], ny, 60, new Date("2026-03-08T00:00:00Z"))?.start.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });
  it("reprograms in priority order without retaining old slots as obstacles", () => {
    const tasks = [task("old-first", "2026-09-22T15:00:00Z", "2026-09-22T16:00:00Z", 1), task("new-first", "2026-09-22T16:00:00Z", "2026-09-22T17:00:00Z", 0)];
    const result = rescheduleAll(tasks, settings, new Date("2026-09-22T15:00:00Z"));
    expect(result.map((t) => t.id)).toEqual(["new-first", "old-first"]);
    expect(result[0]?.scheduledStart.toISOString()).toBe("2026-09-22T15:00:00.000Z");
    expect(result[1]?.scheduledStart.toISOString()).toBe("2026-09-22T16:00:00.000Z");
  });
  it("rejects inverted hours, invalid zones, fractional hours and oversized defaults", () => {
    for (const patch of [{ workEndHour: 8 }, { timezone: "Invalid/Zone" }, { workStartHour: 9.5 }, { workEndHour: 10, defaultDuration: 120 }]) {
      expect(caltodoSettingsSchema.safeParse({ ...settings, ...patch }).success).toBe(false);
    }
    expect(caltodoSettingsSchema.safeParse(settings).success).toBe(true);
  });
  it("renders the correct calendar day across the UTC midnight boundary", () => {
    expect(zonedParts("2026-09-23T01:30:00Z", "America/Mexico_City")).toEqual({ year: 2026, month: 9, day: 22, hour: 19, minute: 30 });
  });
});
