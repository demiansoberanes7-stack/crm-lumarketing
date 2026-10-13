import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { COPILOT_DATA_SOURCES, normalizeCopilotDataSources } from "@/lib/copilot-config";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

const dataSourceSchema = z.enum(COPILOT_DATA_SOURCES.map((source) => source.key) as [string, ...string[]]);
const putSchema = z.object({
  accessMode: z.enum(["selected", "all"]),
  dataSources: z.array(dataSourceSchema).max(COPILOT_DATA_SOURCES.length).optional(),
}).strict().refine(
  (value) => value.accessMode === "all" || (value.dataSources?.length ?? 0) > 0,
  "Selecciona al menos una fuente o elige todo el sistema"
);

/** La configuración del alcance de datos es global al negocio y owner-only. */
export const GET = withOwner(async (session) => {
  const [stored] = await getDb()
    .select()
    .from(schema.copilotSettings)
    .where(scoped(schema.copilotSettings.organizationId, session.organizationId))
    .limit(1);

  return Response.json({
    settings: {
      accessMode: stored?.accessMode === "all" ? "all" : "selected",
      dataSources: normalizeCopilotDataSources(stored?.dataSources),
    },
    sources: COPILOT_DATA_SOURCES,
  });
});

export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const dataSources = body.data.accessMode === "all"
    ? COPILOT_DATA_SOURCES.map((source) => source.key)
    : normalizeCopilotDataSources(body.data.dataSources);
  const values = {
    accessMode: body.data.accessMode,
    dataSources,
    updatedBy: session.userId,
    updatedAt: new Date(),
  };

  try {
    await getDb()
      .insert(schema.copilotSettings)
      .values({ organizationId: session.organizationId, ...values })
      .onConflictDoUpdate({
        target: [schema.copilotSettings.organizationId],
        set: values,
      });
  } catch {
    return apiError(500, "save_failed", "No se pudo guardar el alcance del Copiloto");
  }

  return Response.json({ settings: { accessMode: body.data.accessMode, dataSources } });
});
