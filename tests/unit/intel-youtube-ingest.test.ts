import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";

/**
 * La tabla `intel_video`, el analizador `/api/intel/content` y el conector de
 * YouTube existían, pero nadie insertaba: «Contenido que funciona» no podía
 * tener datos nunca. Estos casos fijan el tramo que ahora sí corre.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getIntelCredentials: vi.fn(),
  markIntelIngested: vi.fn(),
  listMostPopular: vi.fn(),
  listActiveTerms: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/server/intel/credentials", () => ({
  getIntelCredentials: mocks.getIntelCredentials,
  markIntelIngested: mocks.markIntelIngested,
}));
vi.mock("@/server/intel/terms", () => ({ listActiveTerms: mocks.listActiveTerms }));
vi.mock("@/server/intel/sources/youtube", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/intel/sources/youtube")>(),
  youtubeSource: { listMostPopular: mocks.listMostPopular },
}));

const FEED = [
  {
    videoId: "vid_1",
    title: "Cómo armar una PC GAMER en 2026",
    description: "guía completa",
    views: 120_000,
    likes: 4_200,
    durationSeconds: 720,
    publishedAt: "2026-10-01T10:00:00Z",
    channelTitle: "Canales MX",
  },
  {
    videoId: "vid_2",
    title: "Reseña de la nueva cámara IP con visión nocturna",
    description: "unboxing",
    views: 30_000,
    likes: 900,
    durationSeconds: 45,
    publishedAt: "no-es-fecha",
    channelTitle: null,
  },
  {
    videoId: "vid_3",
    title: "Noticia nacional sin que ver con ningún nicho",
    description: "",
    views: 1,
    likes: 0,
    durationSeconds: null,
    publishedAt: null,
    channelTitle: null,
  },
];

const TERMS = [
  { id: "term_pc", name: "Computo de escritorio", keywords: ["pc gamer"], geo: "MX", active: true },
  { id: "term_cam", name: "Cámaras IP", keywords: ["camara ip"], geo: "MX", active: true },
];

let written: Array<Record<string, unknown>> = [];
let conflicts: Array<{ target: unknown; set: Record<string, unknown> }> = [];

beforeEach(() => {
  written = [];
  conflicts = [];
  // Solo los contadores: las implementaciones se fijan justo debajo.
  vi.clearAllMocks();
  mocks.markIntelIngested.mockResolvedValue(undefined);
  mocks.listActiveTerms.mockResolvedValue(TERMS);
  mocks.listMostPopular.mockResolvedValue(FEED);
  mocks.getIntelCredentials.mockResolvedValue({ youtubeKey: "clave" });
  mocks.getDb.mockReturnValue({
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        written.push(v);
        return {
          onConflictDoUpdate: (arg: { target: unknown; set: Record<string, unknown> }) => {
            conflicts.push({ target: arg.target, set: arg.set });
            return Promise.resolve();
          },
        };
      },
    }),
  });
});

describe("runYoutubeIngest", () => {
  it("sin API key no inventa datos: informa el motivo y no escribe", async () => {
    mocks.getIntelCredentials.mockResolvedValue({ youtubeKey: null });
    const { runYoutubeIngest } = await import("@/server/intel/videos");
    const out = await runYoutubeIngest("org_1");

    expect(out).toMatchObject({ ok: false, rows: 0, reason: "missing_youtube_key" });
    expect(mocks.listMostPopular).not.toHaveBeenCalled();
    expect(written).toHaveLength(0);
  });

  it("escribe solo los videos que pegan con un nicho, con su día y org", async () => {
    const { runYoutubeIngest } = await import("@/server/intel/videos");
    const out = await runYoutubeIngest("org_1");

    expect(out).toMatchObject({ ok: true, fetched: 3, rows: 2, matchedTerms: 2 });
    expect(written.map((w) => `${w.termId}:${w.videoId}`)).toEqual([
      "term_pc:vid_1",
      "term_cam:vid_2",
    ]);
    for (const w of written) {
      expect(w.organizationId).toBe("org_1");
      expect(w.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof w.id).toBe("string");
    }
    expect(written[0]).toMatchObject({ views: 120_000, likes: 4_200, durationSeconds: 720 });
    // publishedAt inválida nunca entra como Date NaN: la columna admite null.
    expect(written[1]!.publishedAt).toBeNull();
    expect(mocks.markIntelIngested).toHaveBeenCalledWith("org_1");
  });

  it("repite el día sin desdoblarse: el conflicto va a (término, video, día)", async () => {
    const { runYoutubeIngest } = await import("@/server/intel/videos");
    await runYoutubeIngest("org_1");

    expect(conflicts).toHaveLength(2);
    expect(conflicts[0]!.set).toMatchObject({ views: 120_000, likes: 4_200 });
    expect(conflicts[0]!.target).toEqual([
      schema.intelVideo.termId,
      schema.intelVideo.videoId,
      schema.intelVideo.day,
    ]);
    // El id nuevo no puede pisar la fila existente: el set no toca la PK.
    expect(conflicts[0]!.set).not.toHaveProperty("id");
  });

  it("un feed vacío o sin términos no marca la ingesta como exitosa", async () => {
    mocks.listMostPopular.mockResolvedValue([]);
    const { runYoutubeIngest } = await import("@/server/intel/videos");
    expect(await runYoutubeIngest("org_1")).toMatchObject({ ok: false, reason: "empty_feed" });

    mocks.listMostPopular.mockResolvedValue(FEED);
    mocks.listActiveTerms.mockResolvedValue([]);
    expect(await runYoutubeIngest("org_1")).toMatchObject({ ok: false, reason: "no_terms" });

    expect(mocks.markIntelIngested).not.toHaveBeenCalled();
  });
});
