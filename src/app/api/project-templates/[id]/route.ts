import { apiError, withAuth, withOwner, parseBody } from "@/lib/api";
import { projectTemplateInputSchema, type ProjectTemplateInput } from "@/lib/project-templates";
import {
  deleteProjectTemplate,
  getProjectTemplate,
  updateProjectTemplate,
} from "@/server/projects/templates";
import { projectErrorResponse } from "@/server/projects/errors";

export const dynamic = "force-dynamic";

/** GET — definición completa de un proceso (para el editor y el alta). */
export const GET = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  const template = await getProjectTemplate(session.organizationId, id);
  if (!template) return apiError(404, "not_found", "Proceso no encontrado");
  return Response.json({ template });
});

/** PUT — editar pasos/campos/seguimientos de un proceso propio. */
export const PUT = withOwner(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, projectTemplateInputSchema);
  if (!body.ok) return body.response;

  try {
    const template = await updateProjectTemplate(
      session.organizationId,
      id,
      body.data as ProjectTemplateInput
    );
    return Response.json({ ok: true, template });
  } catch (error) {
    return projectErrorResponse(error);
  }
});

/** DELETE — borrado lógico; los proyectos ya creados conservan su copia. */
export const DELETE = withOwner(async (session, _req, { params }) => {
  const { id } = await params;
  try {
    await deleteProjectTemplate(session.organizationId, id);
    return Response.json({ ok: true });
  } catch (error) {
    return projectErrorResponse(error);
  }
});
