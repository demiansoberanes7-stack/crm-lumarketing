import { z } from "zod";
import { eq } from "drizzle-orm";
import { parseBody, withOwner, apiError } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  url: z.string().url().max(1024).optional(),
  secret: z.string().max(256).optional(),
  events: z.array(z.string()).min(1).optional(),
  active: z.boolean().optional(),
});

/** PATCH — actualizar webhook */
export const PATCH = withOwner(async (session, req: Request, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (body.data.name !== undefined) set.name = body.data.name;
  if (body.data.url !== undefined) set.url = body.data.url;
  if (body.data.events !== undefined) set.events = body.data.events;
  if (body.data.active !== undefined) set.active = body.data.active;

  if (body.data.secret !== undefined) {
    if (body.data.secret) {
      const { encryptSecret } = await import("@/lib/crypto");
      const enc = encryptSecret(body.data.secret);
      set.secretCipher = enc.cipher;
      set.secretIv = enc.iv;
      set.secretTag = enc.tag;
    } else {
      set.secretCipher = null;
      set.secretIv = null;
      set.secretTag = null;
    }
  }

  const rows = await db
    .update(schema.outboundWebhook)
    .set(set)
    .where(
      scoped(
        schema.outboundWebhook.organizationId,
        session.organizationId,
        eq(schema.outboundWebhook.id, id)
      )
    )
    .returning({ id: schema.outboundWebhook.id });

  if (rows.length === 0) return apiError(404, "not_found", "Webhook no encontrado");
  return Response.json({ ok: true });
});

/** DELETE — eliminar webhook */
export const DELETE = withOwner(async (session, _req: Request, { params }: Params) => {
  const { id } = await params;
  const db = getDb();

  // Delete deliveries first
  await db.delete(schema.outboundDelivery).where(
    eq(schema.outboundDelivery.webhookId, id)
  );

  const rows = await db
    .delete(schema.outboundWebhook)
    .where(
      scoped(
        schema.outboundWebhook.organizationId,
        session.organizationId,
        eq(schema.outboundWebhook.id, id)
      )
    )
    .returning({ id: schema.outboundWebhook.id });

  if (rows.length === 0) return apiError(404, "not_found", "Webhook no encontrado");
  return Response.json({ ok: true });
});
