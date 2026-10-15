import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the DB and credentials module before importing the orchestrator
vi.mock("@/server/intel/credentials", () => ({
  getIntelCredentials: vi.fn().mockResolvedValue(null),
  reserveSerpApiUsage: vi.fn().mockResolvedValue(true),
  incrementApifyUsage: vi.fn().mockResolvedValue(undefined),
  markSerpApiSynced: vi.fn().mockResolvedValue(undefined),
  markApifySynced: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/intel/sources/serpapi-trends", () => ({
  fetchSerpApiTrends: vi.fn().mockResolvedValue({
    timeSeries: null,
    regions: [],
    topics: [],
    queries: [],
    partial: true,
    provider: "serpapi",
  }),
  verifySerpApi: vi.fn().mockResolvedValue({ ok: false, reason: "no key" }),
  getSerpApiKey: vi.fn().mockResolvedValue(null),
  getSerpApiQuota: vi.fn().mockReturnValue({ limit: 250, used: 0, remaining: 250 }),
}));

vi.mock("@/server/intel/sources/apify-trends", () => ({
  runApifyActor: vi.fn().mockResolvedValue(null),
  normalizeApifyItems: vi.fn().mockReturnValue({
    timeSeries: null,
    regions: [],
    topics: [],
    queries: [],
    partial: true,
    provider: "apify",
  }),
  verifyApify: vi.fn().mockResolvedValue({ ok: false, reason: "no token" }),
  getApifyCredentials: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/server/intel/sources/google-trends", () => ({
  fetchGt: vi.fn().mockResolvedValue({
    timeSeries: null,
    regions: [],
    topics: [],
    queries: [],
    partial: true,
  }),
  verifyGt: vi.fn().mockResolvedValue({ ok: false }),
}));

const { getTrendsFromProviders, testTrendProvider } = await import("@/server/intel/trends-orchestrator");
const { getIntelCredentials, reserveSerpApiUsage } = await import("@/server/intel/credentials");
const { fetchSerpApiTrends } = await import("@/server/intel/sources/serpapi-trends");
const { fetchGt } = await import("@/server/intel/sources/google-trends");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getIntelCredentials).mockResolvedValue(null);
  vi.mocked(reserveSerpApiUsage).mockResolvedValue(true);
  vi.mocked(fetchSerpApiTrends).mockResolvedValue({
    timeSeries: null, regions: [], topics: [], queries: [], partial: true, provider: "serpapi",
  });
  vi.mocked(fetchGt).mockResolvedValue({
    timeSeries: null, regions: [], topics: [], queries: [], partial: true,
  });
});

describe("Trends orchestrator — sin proveedores", () => {
  it("devuelve none sin datos y mensaje de configuración", async () => {
    const result = await getTrendsFromProviders("org_test", ["tecnología"]);
    expect(result.provider).toBe("none");
    expect(result.data).toBeNull();
    expect(result.sourceLabel).toBe("Sin datos");
    expect(result.error).toContain("Configura SerpApi o Apify");
  });

  it("mensaje diferente si hay proveedores pero fallan", async () => {
    vi.mocked(getIntelCredentials).mockResolvedValue({
      serpapiKey: "fake-key",
      denueToken: null, apifyToken: null, apifyActorId: null,
      youtubeKey: null, lastIngestAt: null, status: "connected",
      youtubeStatus: null, youtubeLastTestAt: null,
      denueStatus: null, denueLastTestAt: null,
      serpapiStatus: null, serpapiLastTestAt: null, serpapiLastSyncAt: null, serpapiQueriesUsed: 0,
      apifyStatus: null, apifyLastTestAt: null, apifyLastSyncAt: null, apifyQueriesUsed: 0,
      gtEnabled: true, gtStatus: null, gtLastTestAt: null, gtLastSyncAt: null,
    } as never);
    const result = await getTrendsFromProviders("org_test", ["tecnología"]);
    expect(result.provider).toBe("none");
    expect(result.error).toContain("Ningún proveedor");
  });
});

describe("Trends orchestrator — testTrendProvider", () => {
  it("serpapi sin credenciales → error", async () => {
    const result = await testTrendProvider("org_test", "serpapi");
    expect(result.ok).toBe(false);
  });

  it("apify sin credenciales → error", async () => {
    const result = await testTrendProvider("org_test", "apify");
    expect(result.ok).toBe(false);
  });
});

describe("Trends orchestrator — flujo SerpApi", () => {
  it("usa SerpApi si responde con serie", async () => {
    vi.mocked(getIntelCredentials).mockResolvedValue({
      serpapiKey: "fake-key",
      denueToken: null, apifyToken: null, apifyActorId: null,
      youtubeKey: null, lastIngestAt: null, status: "connected",
      youtubeStatus: null, youtubeLastTestAt: null,
      denueStatus: null, denueLastTestAt: null,
      serpapiStatus: "ok", serpapiLastTestAt: null, serpapiLastSyncAt: null, serpapiQueriesUsed: 0,
      apifyStatus: null, apifyLastTestAt: null, apifyLastSyncAt: null, apifyQueriesUsed: 0,
      gtEnabled: true, gtStatus: null, gtLastTestAt: null, gtLastSyncAt: null,
    } as never);
    vi.mocked(fetchSerpApiTrends).mockResolvedValue({
      timeSeries: { points: [{ time: 1, value: 50 }, { time: 2, value: 60 }], average: 55 },
      regions: [], topics: [], queries: [], partial: false, provider: "serpapi",
    });

    const result = await getTrendsFromProviders("org_test", ["tecnología"]);
    expect(result.provider).toBe("serpapi");
    expect(result.sourceLabel).toBe("Google Trends · SerpApi");
    expect(result.usedFallback).toBe(false);
    expect(result.data?.timeSeries?.points).toHaveLength(2);
    expect(fetchSerpApiTrends).toHaveBeenCalledWith("fake-key", ["tecnología"], "MX", "today 1-m");
  });

  it("con la cuota agotada NO llama a SerpApi (no se gasta de más)", async () => {
    vi.mocked(getIntelCredentials).mockResolvedValue({
      serpapiKey: "fake-key",
      denueToken: null, apifyToken: null, apifyActorId: null,
      youtubeKey: null, lastIngestAt: null, status: "connected",
      youtubeStatus: null, youtubeLastTestAt: null,
      denueStatus: null, denueLastTestAt: null,
      serpapiStatus: "ok", serpapiLastTestAt: null, serpapiLastSyncAt: null, serpapiQueriesUsed: 250,
      apifyStatus: null, apifyLastTestAt: null, apifyLastSyncAt: null, apifyQueriesUsed: 0,
      gtEnabled: true, gtStatus: null, gtLastTestAt: null, gtLastSyncAt: null,
    } as never);
    vi.mocked(reserveSerpApiUsage).mockResolvedValue(false);

    const result = await getTrendsFromProviders("org_test", ["tecnología"]);
    expect(fetchSerpApiTrends).not.toHaveBeenCalled();
    expect(result.provider).toBe("none");
  });
});
