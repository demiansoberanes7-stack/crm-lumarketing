import { z } from "zod";
import { eq } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

/** GET — obtener un webhook */
export const GET = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.outboundWebhook)
    .where(
      scoped(
        schema.outboundWebhook.organizationId,
        session.organizationId,
        eq(schema.outboundWebhook.id, id)
      )
    )
    .limit(1);

  const webhook = rows[0];
  if (!webhook) return apiError(404, "not_found", "Webhook no encontrado");

  return Response.json({
    webhook: {
      id: webhook.id,
      name: webhook.name,
      url: webhook.url,
      events: webhook.events,
      active: webhook.active,
      maxRetries: webhook.maxRetries,
      createdAt: webhook.createdAt,
    },
  });
});

const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  url: z.string().url().optional(),
  secret: z.string().optional(),
  events: z.array(z.string()).min(1).optional(),
  active: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
});

/** PATCH — actualizar webhook */
export const PATCH = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const updateData: Record<string, unknown> = {};

  if (body.data.name !== undefined) updateData.name = body.data.name;
  if (body.data.url !== undefined) updateData.url = body.data.url;
  if (body.data.events !== undefined) updateData.events = body.data.events;
  if (body.data.active !== undefined) updateData.active = body.data.active;
  if (body.data.maxRetries !== undefined)
    updateData.maxRetries = body.data.maxRetries;

  if (body.data.secret !== undefined) {
    if (body.data.secret) {
      const enc = encryptSecret(body.data.secret);
      updateData.secretCipher = enc.cipher;
      updateData.secretIv = enc.iv;
      updateData.secretTag = enc.tag;
    } else {
      updateData.secretCipher = null;
      updateData.secretIv = null;
      updateData.secretTag = null;
    }
  }

  updateData.updatedAt = new Date();

  await db
    .update(schema.outboundWebhook)
    .set(updateData)
    .where(
      scoped(
        schema.outboundWebhook.organizationId,
        session.organizationId,
        eq(schema.outboundWebhook.id, id)
      )
    );

  return Response.json({ ok: true });
});

/** DELETE — eliminar webhook */
export const DELETE = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  const db = getDb();

  await db
    .delete(schema.outboundWebhook)
    .where(
      scoped(
        schema.outboundWebhook.organizationId,
        session.organizationId,
        eq(schema.outboundWebhook.id, id)
      )
    );

  return Response.json({ ok: true });
});
