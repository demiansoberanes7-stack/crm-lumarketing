import { z } from "zod";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { findTermByKeyword } from "@/server/intel/terms";
import { IngestNotConfiguredError, runIngest } from "@/server/intel/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ keyword: z.string().min(2).max(80) });

/**
 * Monitorear una keyword desde el overview: la agrega al catálogo de
 * términos (o reutiliza el nicho que ya la cubre, sin duplicar) y dispara
 * la ingesta para que entre al share y a las tendencias de inmediato.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "invalid_keyword", message: "Se espera { keyword }" } },
      { status: 422 }
    );
  }
  const keyword = parsed.data.keyword.trim();
  const organizationId = session.organizationId;
  const db = getDb();

  const existingTerms = await db
    .select()
    .from(schema.intelTerm)
    .where(scoped(schema.intelTerm.organizationId, organizationId));
  const covered = findTermByKeyword(
    existingTerms.map((t) => ({
      id: t.id,
      name: t.name,
      keywords: Array.isArray(t.keywords)
        ? t.keywords.filter((k): k is string => typeof k === "string")
        : [],
    })),
    keyword
  );
  if (covered) {
    return Response.json({ termId: covered.id, name: covered.name, created: false });
  }

  const termId = newId("intelTerm");
  await db.insert(schema.intelTerm).values({
    id: termId,
    organizationId,
    name: keyword,
    keywords: [keyword],
    geo: "MX",
    active: true,
  });

  // Captura inmediata para que el nicho nuevo tenga dato del mismo día.
  // Si falla (sin credenciales, red), el término queda listo para la
  // siguiente ingesta manual — nunca bloquea el alta.
  try {
    await runIngest(organizationId);
  } catch (e) {
    if (!(e instanceof IngestNotConfiguredError)) {
      // Degradación silenciosa: el término ya existe; el dato llega luego.
    }
  }

  return Response.json({ termId, name: keyword, created: true });
});
