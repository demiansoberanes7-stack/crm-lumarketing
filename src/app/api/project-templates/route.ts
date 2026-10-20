import { withAuth, withOwner, parseBody } from "@/lib/api";
import { projectTemplateInputSchema, type ProjectTemplateInput } from "@/lib/project-templates";
import {
  createProjectTemplate,
  listProjectTemplates,
} from "@/server/projects/templates";
import { projectErrorResponse } from "@/server/projects/errors";

export const dynamic = "force-dynamic";

/**
 * Procesos de proyecto del negocio. Cualquier miembro los lee (el alta de
 * proyecto los necesita); solo el owner los modifica.
 */
export const GET = withAuth(async (session) => {
  const templates = await listProjectTemplates(session.organizationId);
  return Response.json({ templates, canManage: session.role === "owner" });
});

/** POST — crear un proceso personalizado (hasta 20 por negocio). */
export const POST = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, projectTemplateInputSchema);
  if (!body.ok) return body.response;

  try {
    const template = await createProjectTemplate(
      session.organizationId,
      body.data as ProjectTemplateInput
    );
    return Response.json({ ok: true, template }, { status: 201 });
  } catch (error) {
    return projectErrorResponse(error);
  }
});
