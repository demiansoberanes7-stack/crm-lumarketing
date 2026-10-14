import { z } from "zod";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { findTermByKeyword } from "@/server/intel/terms";
import { getIntelCredentials } from "@/server/intel/credentials";
import { runGtIngest } from "@/server/intel/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ keyword: z.string().min(2).max(80) });

/**
 * Monitorear una keyword desde el overview: la agrega al catálogo de
 * términos (o reutiliza el nicho que ya la cubre, sin duplicar) y dispara
 * la ingesta GT para que entre al ranking de inmediato.
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

  // Captura inmediata GT para que el nicho nuevo tenga dato el mismo día.
  // Si falla (GT deshabilitado, rate limit), el término queda listo para
  // la siguiente ingesta manual — nunca bloquea el alta.
  const creds = await getIntelCredentials(organizationId);
  if (creds?.gtEnabled) {
    await runGtIngest(organizationId, termId).catch(() => undefined);
  }

  return Response.json({ termId, name: keyword, created: true });
});
