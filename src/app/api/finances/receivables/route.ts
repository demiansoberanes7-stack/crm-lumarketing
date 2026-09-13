import { z } from "zod";
import { parseBody, withAuth, apiError } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { validContact } from "@/server/finances/report";
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, z.object({ concept: z.string().trim().min(1).max(255), contactId: z.string().nullable().optional(), totalAmount: z.number().int().positive().max(2000000000), dueDate: z.string().datetime().optional() }));
  if (!body.ok) return body.response;
  if (body.data.contactId && !await validContact(session.organizationId, body.data.contactId)) return apiError(422, "invalid_contact", "Contacto no válido");
  const id = newId("charge");
  await getDb().insert(schema.charge).values({ id, organizationId: session.organizationId, ...body.data, dueDate: body.data.dueDate ? new Date(body.data.dueDate) : null, status: "pendiente" });
  return Response.json({ id }, { status: 201 });
});
