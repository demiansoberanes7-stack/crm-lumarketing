import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  question: z.string().trim().min(1).max(500).optional(),
  answer: z.string().trim().min(1).max(4000).optional(),
  content: z.string().trim().min(1).max(8000).optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  await db
    .update(schema.kbEntry)
    .set({ ...body.data, updatedAt: new Date() })
    .where(
      scoped(
        schema.kbEntry.organizationId,
        session.organizationId,
        eq(schema.kbEntry.id, id)
      )
    );
  const [entry] = await db
    .select()
    .from(schema.kbEntry)
    .where(
      scoped(
        schema.kbEntry.organizationId,
        session.organizationId,
        eq(schema.kbEntry.id, id)
      )
    )
    .limit(1);
  if (!entry) return apiError(404, "not_found", "Entrada no encontrada");
  return Response.json({ entry });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.kbEntry.id })
    .from(schema.kbEntry)
    .where(
      scoped(
        schema.kbEntry.organizationId,
        session.organizationId,
        eq(schema.kbEntry.id, id)
      )
    )
    .limit(1);
  if (!existing) return apiError(404, "not_found", "Entrada no encontrada");
  await db
    .delete(schema.kbEntry)
    .where(
      scoped(
        schema.kbEntry.organizationId,
        session.organizationId,
        eq(schema.kbEntry.id, id)
      )
    );
  return Response.json({ deleted: true });
});
