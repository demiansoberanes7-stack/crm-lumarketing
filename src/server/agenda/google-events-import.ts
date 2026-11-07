import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { agendaEnabled } from "@/server/agenda/flag";
import { googleFetch } from "@/server/agenda/connectors/google";
import {
  getBusinessGoogleCredentials,
  markGoogleError,
  type GoogleCreds,
} from "@/server/agenda/connectors/google-credentials";
import { recordDiagnostic } from "@/server/diagnostics/logger";

/** Separate from the outbound marker: each direction has its own cursor. */
const PROVIDER = "google_calendar_import";
const PAGE_SIZE = 2500;
const MAX_PAGES_PER_TICK = 5;

type GoogleEvent = {
  id?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  eventType?: string;
  transparency?: "opaque" | "transparent";
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
};

type GoogleEventsPage = {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

type Cursor = {
  calendarId: string;
  syncToken?: string;
  pageToken?: string;
};

type ParsedEvent = {
  id: string;
  status: "confirmed" | "tentative" | "cancelled";
  start: Date;
  durationMinutes: number;
  title: string | null;
  location: string | null;
  notes: string | null;
  meetingLink: string | null;
};

type BookingRow = typeof schema.booking.$inferSelect;

function cursorFromDetail(detail: unknown, calendarId: string): Cursor {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    return { calendarId };
  }
  const value = detail as Record<string, unknown>;
  if (value.calendarId !== calendarId) return { calendarId };
  return {
    calendarId,
    ...(typeof value.syncToken === "string" ? { syncToken: value.syncToken } : {}),
    ...(typeof value.pageToken === "string" ? { pageToken: value.pageToken } : {}),
  };
}

function parseEvent(event: GoogleEvent): ParsedEvent | null {
  if (!event.id || event.status === "cancelled") return null;
  // Calendar all-day markers, working-location and focus-time entries are not
  // appointments in this CRM. Transparent events do not reserve time either.
  if (event.eventType && event.eventType !== "default") return null;
  if (event.transparency === "transparent") return null;
  const startText = event.start?.dateTime;
  const endText = event.end?.dateTime;
  if (!startText || !endText) return null;
  const start = new Date(startText);
  const end = new Date(endText);
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  if (minutes < 5 || minutes > 600) return null;

  const description = event.description ?? "";
  const descriptionLink = description.match(
    /(?:^|\n)Enlace de la reunión:\s*(https?:\/\/\S+)/i
  )?.[1];
  const notes = description
    .split(/\r?\n/)
    .filter((line) => !/^Enlace de la reunión:\s*https?:\/\//i.test(line.trim()))
    .join("\n")
    .trim();
  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video"
  );

  return {
    id: event.id,
    status: event.status === "tentative" ? "tentative" : "confirmed",
    start,
    durationMinutes: minutes,
    title: event.summary?.trim().slice(0, 255) || null,
    location: event.location?.trim().slice(0, 255) || null,
    notes: notes || null,
    meetingLink: event.hangoutLink ?? video?.uri ?? descriptionLink ?? null,
  };
}

function eventIsCancelled(event: GoogleEvent): boolean {
  return Boolean(event.id && event.status === "cancelled");
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

async function readCursor(organizationId: string, calendarId: string): Promise<Cursor> {
  const rows = await getDb()
    .select({ detail: schema.syncState.detail })
    .from(schema.syncState)
    .where(
      scoped(
        schema.syncState.organizationId,
        organizationId,
        eq(schema.syncState.provider, PROVIDER)
      )
    )
    .limit(1);
  return cursorFromDetail(rows[0]?.detail, calendarId);
}

async function saveCursor(
  organizationId: string,
  cursor: Cursor,
  status: "ok" | "error",
  detail: Record<string, unknown>,
  error: string | null = null
): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(schema.syncState)
    .values({
      id: newId("syncState"),
      organizationId,
      provider: PROVIDER,
      lastSyncAt: now,
      lastStatus: status,
      lastError: error,
      detail: { ...cursor, ...detail },
    })
    .onConflictDoUpdate({
      target: [schema.syncState.organizationId, schema.syncState.provider],
      set: {
        lastSyncAt: now,
        lastStatus: status,
        lastError: error,
        detail: { ...cursor, ...detail },
        updatedAt: now,
      },
    });
}

function eventsUrl(creds: GoogleCreds, cursor: Cursor): string {
  const query = new URLSearchParams({
    eventTypes: "default",
    maxResults: String(PAGE_SIZE),
    showDeleted: "true",
    singleEvents: "true",
  });
  if (cursor.syncToken) query.set("syncToken", cursor.syncToken);
  if (cursor.pageToken) query.set("pageToken", cursor.pageToken);
  return `/calendars/${encodeURIComponent(creds.calendarId)}/events?${query.toString()}`;
}

function byStart(rows: BookingRow[]): Map<number, BookingRow[]> {
  const result = new Map<number, BookingRow[]>();
  for (const row of rows) {
    const time = row.scheduledAt.getTime();
    const at = result.get(time) ?? [];
    at.push(row);
    result.set(time, at);
  }
  return result;
}

async function importPage(
  organizationId: string,
  page: GoogleEventsPage
): Promise<{ imported: number; updated: number; cancelled: number; conflicts: number }> {
  const db = getDb();
  const events = page.items ?? [];
  const ids = [...new Set(events.flatMap((event) => (event.id ? [event.id] : [])))];
  if (!ids.length) return { imported: 0, updated: 0, cancelled: 0, conflicts: 0 };

  const parsed = events.flatMap((event) => {
    const value = parseEvent(event);
    return value ? [value] : [];
  });
  const starts = [...new Map(parsed.map((event) => [event.start.getTime(), event.start])).values()];

  const [linkedRows, occupiedRows] = await Promise.all([
    db
      .select()
      .from(schema.booking)
      .where(
        scoped(
          schema.booking.organizationId,
          organizationId,
          inArray(schema.booking.googleEventId, ids)
        )
      ),
    starts.length
      ? db
          .select()
          .from(schema.booking)
          .where(
            scoped(
              schema.booking.organizationId,
              organizationId,
              and(
                eq(schema.booking.status, "agendada"),
                eq(schema.booking.isTest, false),
                inArray(schema.booking.scheduledAt, starts)
              )
            )
          )
      : Promise.resolve([] as BookingRow[]),
  ]);

  const linked = new Map(
    (linkedRows as BookingRow[]).flatMap((row) =>
      row.googleEventId ? [[row.googleEventId, row] as const] : []
    )
  );
  const occupied = byStart(occupiedRows as BookingRow[]);
  const changes = { imported: 0, updated: 0, cancelled: 0, conflicts: 0 };

  for (const raw of events) {
    if (!raw.id) continue;
    const existing = linked.get(raw.id);
    if (eventIsCancelled(raw)) {
      if (existing && existing.status !== "cancelada") {
        await db
          .update(schema.booking)
          .set({ status: "cancelada", updatedAt: new Date() })
          .where(
            scoped(
              schema.booking.organizationId,
              organizationId,
              eq(schema.booking.id, existing.id)
            )
          );
        const oldAt = existing.scheduledAt.getTime();
        occupied.set(
          oldAt,
          (occupied.get(oldAt) ?? []).filter((row) => row.id !== existing.id)
        );
        linked.set(raw.id, { ...existing, status: "cancelada" });
        changes.cancelled++;
        publish(organizationId, { type: "booking.updated", data: { bookingId: existing.id } });
      }
      continue;
    }

    const value = parseEvent(raw);
    if (!value) continue;

    if (existing) {
      // A CRM cancellation is an explicit owner action; a stale/undeleted Google
      // event must not resurrect it. A Google deletion, handled above, still
      // cancels the CRM row in the same direction.
      if (existing.status === "cancelada") continue;
      const conflicts = (occupied.get(value.start.getTime()) ?? []).filter(
        (row) => row.id !== existing.id
      );
      if (conflicts.length) {
        changes.conflicts++;
        continue;
      }
      const oldAt = existing.scheduledAt.getTime();
      await db
        .update(schema.booking)
        .set({
          scheduledAt: value.start,
          durationMinutes: value.durationMinutes,
          title: value.title,
          location: value.location,
          notes: value.notes,
          meetingLink: value.meetingLink,
          updatedAt: new Date(),
        })
        .where(
          scoped(
            schema.booking.organizationId,
            organizationId,
            eq(schema.booking.id, existing.id)
          )
        );
      occupied.set(
        oldAt,
        (occupied.get(oldAt) ?? []).filter((row) => row.id !== existing.id)
      );
      const next = {
        ...existing,
        scheduledAt: value.start,
        durationMinutes: value.durationMinutes,
        title: value.title,
        location: value.location,
        notes: value.notes,
        meetingLink: value.meetingLink,
      };
      occupied.set(value.start.getTime(), [...(occupied.get(value.start.getTime()) ?? []), next]);
      linked.set(raw.id, next);
      changes.updated++;
      publish(organizationId, { type: "booking.updated", data: { bookingId: existing.id } });
      continue;
    }

    if ((occupied.get(value.start.getTime()) ?? []).length) {
      // The existing active booking may be a different appointment. Keep both
      // systems truthful rather than stealing its unique time slot.
      changes.conflicts++;
      continue;
    }

    const id = newId("booking");
    const [created] = await db
      .insert(schema.booking)
      .values({
        id,
        organizationId,
        kind: "session",
        status: "agendada",
        source: "google",
        title: value.title,
        location: value.location,
        scheduledAt: value.start,
        durationMinutes: value.durationMinutes,
        connector: "enlace-fijo",
        googleEventId: value.id,
        meetingLink: value.meetingLink,
        notes: value.notes,
        isTest: false,
      })
      .returning();
    const row = created as BookingRow | undefined;
    if (!row) continue;
    linked.set(raw.id, row);
    occupied.set(value.start.getTime(), [...(occupied.get(value.start.getTime()) ?? []), row]);
    changes.imported++;
    publish(organizationId, { type: "booking.updated", data: { bookingId: id } });
  }

  if (changes.conflicts) {
    await recordDiagnostic({
      organizationId,
      source: "agenda",
      code: "google_calendar_booking_conflict",
      severity: "warning",
      error: `${changes.conflicts} evento(s) coinciden con citas ya existentes; no se duplicaron.`,
      metadata: { conflicts: changes.conflicts },
    }).catch(() => {});
  }
  return changes;
}

/**
 * Incremental Google Calendar → CRM import. The initial pass pages through the
 * calendar once; subsequent passes use Google's syncToken. Event ids are the
 * idempotency key, and imported rows retain that id for edits and deletions.
 */
export async function syncGoogleCalendarEvents(
  organizationId: string
): Promise<{ imported: number; updated: number; cancelled: number; conflicts: number; failed: number }> {
  const empty = { imported: 0, updated: 0, cancelled: 0, conflicts: 0, failed: 0 };
  if (!agendaEnabled()) return empty;
  const creds = await getBusinessGoogleCredentials(organizationId);
  if (!creds || creds.status !== "connected") return empty;

  let cursor = await readCursor(organizationId, creds.calendarId);
  const totals = { ...empty };
  try {
    for (let pageNumber = 0; pageNumber < MAX_PAGES_PER_TICK; pageNumber++) {
      const page = (await googleFetch(creds, eventsUrl(creds, cursor))) as GoogleEventsPage | null;
      if (!page) throw new Error("Google Calendar devolvió una respuesta vacía al listar eventos.");
      const changes = await importPage(organizationId, page);
      totals.imported += changes.imported;
      totals.updated += changes.updated;
      totals.cancelled += changes.cancelled;
      totals.conflicts += changes.conflicts;

      if (page.nextPageToken) {
        cursor = { ...cursor, pageToken: page.nextPageToken };
        await saveCursor(organizationId, cursor, "ok", { ...totals, syncing: true });
        continue;
      }
      if (page.nextSyncToken) {
        cursor = { calendarId: creds.calendarId, syncToken: page.nextSyncToken };
      } else {
        cursor = { calendarId: creds.calendarId };
      }
      await saveCursor(organizationId, cursor, "ok", { ...totals, syncing: false });
      return totals;
    }
    return totals;
  } catch (error) {
    if (errorStatus(error) === 410 && (cursor.syncToken || cursor.pageToken)) {
      // Google's sync/page tokens expire periodically. Clear them and restart a
      // full sync next tick; event-id upserts make that safe and duplicate-free.
      cursor = { calendarId: creds.calendarId };
      await saveCursor(organizationId, cursor, "error", { ...totals, syncing: true }, "sync token expired");
      return { ...totals, failed: 1 };
    }
    const message = error instanceof Error ? error.message : String(error);
    await recordDiagnostic({
      organizationId,
      source: "agenda",
      code: "google_calendar_import_failed",
      severity: "warning",
      error,
      metadata: { calendarId: creds.calendarId },
    }).catch(() => {});
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { isAuthError?: unknown }).isAuthError === true
    ) {
      await markGoogleError(organizationId, null).catch(() => {});
    }
    await saveCursor(organizationId, cursor, "error", { ...totals }, message).catch(() => {});
    return { ...totals, failed: 1 };
  }
}
