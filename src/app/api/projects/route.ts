import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { PROJECT_TYPE_KEYS } from "@/lib/project-types";
import { listProjects, createProject } from "@/server/projects/service";
import { projectErrorResponse } from "@/server/projects/errors";

export const dynamic = "force-dynamic";

/** GET — listar proyectos */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const estado = url.searchParams.get("estado") ?? undefined;
  const archivedParam = url.searchParams.get("archived");
  const archived = archivedParam === "true" ? true : archivedParam === "false" ? false : undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  const projects = await listProjects(session.organizationId, { estado, archived, limit, offset });
  return Response.json({ projects });
});

const postSchema = z.object({
  name: z.string().trim().min(1).max(255),
  contactId: z.string().nullable().optional(),
  service: z.string().max(100).nullable().optional(),
  projectType: z.enum(PROJECT_TYPE_KEYS).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD").nullable().optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD").nullable().optional(),
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

  try {
  const id = await createProject(session.organizationId, {
    name: body.data.name,
    contactId: body.data.contactId ?? undefined,
    service: body.data.service ?? undefined,
    projectType: body.data.projectType,
    startDate: body.data.startDate ? new Date(`${body.data.startDate}T00:00:00.000Z`) : null,
    endDate: body.data.endDate ? new Date(`${body.data.endDate}T00:00:00.000Z`) : null,
    estado: body.data.estado,
    prioridad: body.data.prioridad ?? undefined,
    riesgo: body.data.riesgo ?? undefined,
    notas: body.data.notas ?? undefined,
    assignedUserId: body.data.assignedUserId ?? undefined,
  });
  return Response.json({ ok: true, projectId: id }, { status: 201 });
  } catch (error) { return projectErrorResponse(error); }
});
