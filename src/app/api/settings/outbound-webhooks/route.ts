import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

/** GET — listar webhooks de la organización */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const webhooks = await db
    .select()
    .from(schema.outboundWebhook)
    .where(scoped(schema.outboundWebhook.organizationId, session.organizationId));

  return Response.json({
    webhooks: webhooks.map((w) => ({
      id: w.id,
      name: w.name,
      url: w.url,
      events: w.events,
      active: w.active,
      maxRetries: w.maxRetries,
      createdAt: w.createdAt,
    })),
  });
});

const postSchema = z.object({
  name: z.string().min(1).max(255),
  url: z.string().url(),
  secret: z.string().optional(),
  events: z.array(z.string()).min(1),
  maxRetries: z.number().int().min(0).max(10).default(3),
});

/** POST — crear webhook */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const id = newId("outboundWebhook");

  let secretFields = {};
  if (body.data.secret) {
    const enc = encryptSecret(body.data.secret);
    secretFields = {
      secretCipher: enc.cipher,
      secretIv: enc.iv,
      secretTag: enc.tag,
    };
  }

  await db.insert(schema.outboundWebhook).values({
    id,
    organizationId: session.organizationId,
    name: body.data.name,
    url: body.data.url,
    events: body.data.events,
    maxRetries: body.data.maxRetries,
    ...secretFields,
  });

  return Response.json({ ok: true, webhook: { id } }, { status: 201 });
});
