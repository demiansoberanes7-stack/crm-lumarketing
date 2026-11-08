import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  processInboundWebhookEvent: vi.fn(),
}));

type EventRow = {
  id: string;
  organizationId: string;
  provider: string;
  idempotencyKey: string;
  rawBody: string | null;
  status: "pending" | "processed" | "failed";
  runAt: Date;
  lockedUntil: Date | null;
  lockToken: string | null;
  attempts: number;
  lastError: string | null;
  receivedAt: Date;
  processedAt: Date | null;
};

const state = {
  events: [] as EventRow[],
  lockedIds: new Set<string>(),
  insertConflicts: [] as unknown[][],
  claimOptions: [] as { skipLocked?: boolean }[],
};

function render(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never);
}

function fakeDb() {
  function queryApi(): Record<string, unknown> {
    return {
      select: () => {
        const chain: Record<string, unknown> = {};
        let table = "";
        let query: { sql: string; params: unknown[] } = { sql: "", params: [] };
        let wantsLock = false;
        chain.from = (source: unknown) => {
          table = getTableName(source as never);
          return chain;
        };
        chain.where = (condition: unknown) => {
          query = render(condition);
          return chain;
        };
        chain.orderBy = () => chain;
        chain.for = (_mode: string, options?: { skipLocked?: boolean }) => {
          wantsLock = true;
          state.claimOptions.push(options ?? {});
          return chain;
        };
        chain.limit = async (limit: number) => {
          if (table !== "inbound_webhook_event") return [];
          const dateParam = [...query.params].reverse().find(
            (param) =>
              param instanceof Date ||
              (typeof param === "string" && Number.isFinite(Date.parse(param)))
          );
          const now = dateParam ? new Date(dateParam as Date | string) : new Date();
          const id = state.events.find((event) => query.params.includes(event.id))?.id;
          const key = state.events.find((event) => query.params.includes(event.idempotencyKey))?.id;
          if (id) return state.events.filter((event) => event.id === id).slice(0, limit);
          if (key) return state.events.filter((event) => event.id === key).slice(0, limit);
          const pending = state.events.find(
            (event) =>
              event.status === "pending" &&
              event.runAt.getTime() <= now.getTime() &&
              (!event.lockedUntil || event.lockedUntil.getTime() <= now.getTime()) &&
              (!wantsLock || !state.lockedIds.has(event.id))
          );
          if (!pending) return [];
          if (wantsLock) state.lockedIds.add(pending.id);
          return [pending];
        };
        (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
          Promise.resolve(table === "organization" ? [] : []).then(resolve);
        return chain;
      },
      insert: (source: unknown) => {
        const table = getTableName(source as never);
        return {
          values: (values: EventRow) => ({
            onConflictDoNothing: (config: { target?: unknown[] }) => {
              state.insertConflicts.push(config.target ?? []);
              return {
                returning: async () => {
                  if (table !== "inbound_webhook_event") return [];
                  const duplicate = state.events.find(
                    (event) =>
                      event.organizationId === values.organizationId &&
                      event.provider === values.provider &&
                      event.idempotencyKey === values.idempotencyKey
                  );
                  if (duplicate) return [];
                  state.events.push({ ...values });
                  return [{ id: values.id }];
                },
              };
            },
          }),
        };
      },
      update: (source: unknown) => {
        const table = getTableName(source as never);
        return {
          set: (values: Record<string, unknown>) => ({
            where: (condition: unknown) => {
              const query = render(condition);
              const apply = () => {
                const event = state.events.find((row) => query.params.includes(row.id));
                if (!event || table !== "inbound_webhook_event") return [];
                for (const [key, value] of Object.entries(values)) {
                  if (key === "attempts") event.attempts += 1;
                  else Object.assign(event, { [key]: value });
                }
                state.lockedIds.delete(event.id);
                return [{ ...event }];
              };
              const result: Record<string, unknown> = {
                returning: () => Promise.resolve(apply()),
              };
              (result as { then: unknown }).then = (resolve: (value: unknown[]) => void) =>
                Promise.resolve(apply()).then(resolve);
              return result;
            },
          }),
        };
      },
      transaction: async (run: (tx: ReturnType<typeof queryApi>) => Promise<unknown>) => run(queryApi()),
    };
  }
  return queryApi();
}

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));
vi.mock("@/server/webhooks/inbound-dispatch", () => ({
  processInboundWebhookEvent: mocks.processInboundWebhookEvent,
}));

import {
  claimInboundWebhookEvent,
  enqueueInboundWebhook,
  runInboundWebhookWorkerOnce,
} from "@/server/webhooks/inbound-queue";

beforeEach(() => {
  vi.resetAllMocks();
  state.events = [];
  state.lockedIds.clear();
  state.insertConflicts = [];
  state.claimOptions = [];
  mocks.getDb.mockReturnValue(fakeDb());
  mocks.processInboundWebhookEvent.mockResolvedValue(undefined);
});

describe("cola durable de webhooks", () => {
  it("persiste el body crudo como pendiente antes de devolver el ACK de la cola", async () => {
    const rawBody = '{"event":"message.received","message":{"id":"wamid_1"}}';

    const result = await enqueueInboundWebhook({
      organizationId: "org_1",
      provider: "zernio_whatsapp",
      idempotencyKey: "event-hash-1",
      eventType: "message.received",
      rawBody,
    });

    expect(result).toMatchObject({ persisted: true, duplicate: false });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      organizationId: "org_1",
      provider: "zernio_whatsapp",
      idempotencyKey: "event-hash-1",
      rawBody,
      status: "pending",
      attempts: 0,
    });
    expect(state.insertConflicts[0]).toHaveLength(3);
  });

  it("la reentrega con la misma clave reutiliza la fila idempotente", async () => {
    const event = {
      organizationId: "org_1",
      provider: "meta_whatsapp" as const,
      idempotencyKey: "same-hash",
      eventType: "messages.message",
      rawBody: '{"entry":[]}',
    };
    await enqueueInboundWebhook(event);

    const duplicate = await enqueueInboundWebhook(event);

    expect(duplicate).toMatchObject({ persisted: true, duplicate: true });
    expect(state.events).toHaveLength(1);
  });

  it("reclama con SKIP LOCKED y marca procesado después del handler", async () => {
    await enqueueInboundWebhook({
      organizationId: "org_1",
      provider: "waha",
      idempotencyKey: "waha-event-1",
      eventType: "message.any",
      rawBody: '{"event":"message.any"}',
    });

    const result = await runInboundWebhookWorkerOnce();

    expect(result).toMatchObject({ processed: 1, retried: 0, failed: 0 });
    expect(state.claimOptions).toContainEqual({ skipLocked: true });
    expect(mocks.processInboundWebhookEvent).toHaveBeenCalledTimes(1);
    expect(state.events[0]).toMatchObject({ status: "processed", rawBody: null });
    expect(state.events[0]?.processedAt).toBeInstanceOf(Date);
  });

  it("dos claims concurrentes no reclaman la misma fila", async () => {
    await enqueueInboundWebhook({
      organizationId: "org_1",
      provider: "waha",
      idempotencyKey: "concurrent-event",
      eventType: "message.any",
      rawBody: '{"event":"message.any"}',
    });

    const now = new Date();
    const claims = await Promise.all([
      claimInboundWebhookEvent(now),
      claimInboundWebhookEvent(now),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ attempts: 1, status: "pending" });
    expect(state.claimOptions).toContainEqual({ skipLocked: true });
  });

  it("recupera una fila cuyo worker murió cuando vence la lease", async () => {
    await enqueueInboundWebhook({
      organizationId: "org_1",
      provider: "waha",
      idempotencyKey: "expired-lease-event",
      eventType: "message.any",
      rawBody: '{"event":"message.any"}',
    });

    const firstClaim = await claimInboundWebhookEvent(new Date());
    expect(firstClaim?.lockToken).toBeTruthy();
    expect(await claimInboundWebhookEvent(new Date())).toBeNull();

    state.events[0]!.lockedUntil = new Date(Date.now() - 1);
    const recovered = await claimInboundWebhookEvent(new Date());

    expect(recovered).toMatchObject({ status: "pending", attempts: 2 });
    expect(recovered?.lockToken).not.toBe(firstClaim?.lockToken);
  });

  it("un error reprograma el evento con backoff en vez de perderlo", async () => {
    await enqueueInboundWebhook({
      organizationId: "org_1",
      provider: "meta_instagram",
      idempotencyKey: "ig-event-1",
      eventType: "message",
      rawBody: '{"object":"instagram"}',
    });
    mocks.processInboundWebhookEvent.mockRejectedValueOnce(new Error("red temporal"));

    const result = await runInboundWebhookWorkerOnce();

    expect(result).toMatchObject({ processed: 0, retried: 1, failed: 0 });
    expect(state.events[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(state.events[0]?.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(state.events[0]?.lockedUntil).toBeNull();
    expect(state.events[0]?.lastError).toContain("red temporal");
  });

  it("agota reintentos y conserva el evento como fallido", async () => {
    await enqueueInboundWebhook({
      organizationId: "org_1",
      provider: "meta_whatsapp",
      idempotencyKey: "poison-event",
      eventType: "messages.message",
      rawBody: '{"entry":[]}',
    });
    mocks.processInboundWebhookEvent.mockRejectedValue(
      new Error("fallo persistente token=super-secret-value")
    );

    for (let attempt = 0; attempt < 8; attempt++) {
      await runInboundWebhookWorkerOnce(new Date(Date.now() + 24 * 60 * 60_000));
    }

    expect(state.events[0]).toMatchObject({ status: "failed", attempts: 8 });
    expect(state.events[0]?.rawBody).toBe('{"entry":[]}');
    expect(state.events[0]?.lastError).toContain("fallo persistente token=[redacted]");
    expect(state.events[0]?.lastError).not.toContain("super-secret-value");
  });
});
