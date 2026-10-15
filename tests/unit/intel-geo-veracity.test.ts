import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEXICO_STATES } from "@/lib/mexico-states";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getIntelCredentials: vi.fn(),
}));

let selectQueue: unknown[][] = [];

function chain(rows: unknown[]) {
  const query: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy"]) {
    query[method] = () => query;
  }
  query.limit = () => Promise.resolve(rows);
  (query as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return query;
}

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/server/intel/credentials", () => ({
  getIntelCredentials: mocks.getIntelCredentials,
}));

beforeEach(() => {
  selectQueue = [];
  mocks.getIntelCredentials.mockResolvedValue({ denueToken: "token" });
  mocks.getDb.mockReturnValue({
    select: () => chain(selectQueue.shift() ?? []),
  });
});

function termAndLatest() {
  selectQueue.push(
    [{ id: "term_1", name: "cafeterías" }],
    [{ day: "2026-10-15" }],
  );
}

function snapshot(state: string, count: number, censored = false) {
  return { state, count, censored };
}

describe("veracidad del reporte geográfico DENUE", () => {
  it("marca como sin dato los estados ausentes y no calcula porcentajes falsos", async () => {
    termAndLatest();
    selectQueue.push([
      snapshot("01", 4),
      snapshot("02", 0),
    ]);

    const { getGeoReport } = await import("@/server/intel/geo");
    const report = await getGeoReport("org_1", "term_1");

    expect(report).toMatchObject({
      available: true,
      totalLowerBound: 4,
      totalExact: false,
      missingStates: MEXICO_STATES.length - 2,
      censoredStates: 0,
    });
    if (!report.available) throw new Error("expected report");
    expect(report.states.find((state) => state.code === "01")).toMatchObject({
      status: "ok",
      count: 4,
      sharePct: null,
    });
    expect(report.states.find((state) => state.code === "02")).toMatchObject({
      status: "ok",
      count: 0,
      sharePct: null,
    });
    expect(report.states.find((state) => state.code === "03")).toMatchObject({
      status: "missing",
      count: 0,
      sharePct: null,
    });
  });

  it("trata un conteo censurado como límite inferior", async () => {
    termAndLatest();
    selectQueue.push([snapshot("01", 10, true)]);

    const { getGeoReport } = await import("@/server/intel/geo");
    const report = await getGeoReport("org_1", "term_1");

    expect(report).toMatchObject({
      totalLowerBound: 10,
      totalExact: false,
      censoredStates: 1,
    });
    if (!report.available) throw new Error("expected report");
    expect(report.states.find((state) => state.code === "01")).toMatchObject({
      status: "censored",
      censored: true,
      sharePct: null,
    });
  });

  it("solo calcula total y shares exactos con los 32 estados sin censura", async () => {
    termAndLatest();
    selectQueue.push(MEXICO_STATES.map((state, index) => snapshot(state.code, index + 1)));

    const { getGeoReport } = await import("@/server/intel/geo");
    const report = await getGeoReport("org_1", "term_1");

    expect(report).toMatchObject({
      totalLowerBound: MEXICO_STATES.reduce((sum, _, index) => sum + index + 1, 0),
      totalExact: true,
      missingStates: 0,
      censoredStates: 0,
    });
    if (!report.available) throw new Error("expected report");
    expect(report.states.find((state) => state.code === "01")?.sharePct).toBeGreaterThan(0);
  });
});
