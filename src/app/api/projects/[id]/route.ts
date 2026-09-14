import { apiError, withAuth, parseBody } from "@/lib/api";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getProject } from "@/server/projects/service";

export const dynamic = "force-dynamic";

/** GET — obtener proyecto con etapa actual */
export const GET = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  const project = await getProject(session.organizationId, id);
  if (!project) return apiError(404, "not_found", "Proyecto no encontrado");
  return Response.json({ project });
});

export const PATCH = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, z.object({
    name: z.string().trim().min(1).max(255).optional(),
    contactId: z.string().min(1).nullable().optional(),
    service: z.string().max(255).nullable().optional(),
    estado: z.enum(["activo", "reunion", "cerrado"]).optional(),
    prioridad: z.enum(["alta", "media", "baja"]).nullable().optional(),
    notas: z.string().max(10000).nullable().optional(),
  }).strict());
  if (!body.ok) return body.response;
  const db = getDb();
  if (body.data.contactId) {
    const [contact] = await db.select({ id: schema.contact.id }).from(schema.contact).where(scoped(schema.contact.organizationId, session.organizationId, eq(schema.contact.id, body.data.contactId)));
    if (!contact) return apiError(422, "invalid_contact", "El contacto no pertenece a tu organización");
  }
  const [project] = await db.update(schema.project).set({ ...body.data, updatedAt: new Date() }).where(scoped(schema.project.organizationId, session.organizationId, eq(schema.project.id, id))).returning();
  if (!project) return apiError(404, "not_found", "Proyecto no encontrado");
  return Response.json({ project });
});
