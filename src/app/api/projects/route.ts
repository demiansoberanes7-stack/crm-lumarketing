import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { listProjects, createProject } from "@/server/projects/service";

export const dynamic = "force-dynamic";

/** GET — listar proyectos */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const estado = url.searchParams.get("estado") ?? undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  const projects = await listProjects(session.organizationId, { estado, limit, offset });
  return Response.json({ projects });
});

const postSchema = z.object({
  name: z.string().min(1),
  contactId: z.string().nullable().optional(),
  service: z.string().nullable().optional(),
  estado: z.enum(["activo", "reunion", "cerrado"]).optional(),
  prioridad: z.enum(["alta", "media", "baja"]).nullable().optional(),
  riesgo: z.enum(["bajo", "medio", "alto"]).nullable().optional(),
  notas: z.string().nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
});

/** POST — crear proyecto */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  const id = await createProject(session.organizationId, {
    name: body.data.name,
    contactId: body.data.contactId ?? undefined,
    service: body.data.service ?? undefined,
    estado: body.data.estado,
    prioridad: body.data.prioridad ?? undefined,
    riesgo: body.data.riesgo ?? undefined,
    notas: body.data.notas ?? undefined,
    assignedUserId: body.data.assignedUserId ?? undefined,
  });
  return Response.json({ ok: true, projectId: id }, { status: 201 });
});
