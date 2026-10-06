import { parseBody, withAuth } from "@/lib/api";
import { createItemSchema } from "@/lib/project-contract";
import { getProject } from "@/server/projects/service";
import { createItem, listItems } from "@/server/projects/items";
import { ProjectError, projectErrorResponse } from "@/server/projects/errors";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  try {
    if (!(await getProject(session.organizationId, id)))
      throw new ProjectError(404, "Proyecto no encontrado");
    return Response.json({ items: await listItems(session.organizationId, id) });
  } catch (error) {
    return projectErrorResponse(error);
  }
});

export const POST = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, createItemSchema);
  if (!body.ok) return body.response;
  try {
    if (!(await getProject(session.organizationId, id)))
      throw new ProjectError(404, "Proyecto no encontrado");
    const itemId = await createItem(session.organizationId, id, body.data);
    return Response.json({ ok: true, itemId }, { status: 201 });
  } catch (error) {
    return projectErrorResponse(error);
  }
});
