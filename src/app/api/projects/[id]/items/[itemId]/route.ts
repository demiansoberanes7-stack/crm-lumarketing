import { parseBody, withAuth } from "@/lib/api";
import { updateItemSchema } from "@/lib/project-contract";
import { deleteItem, updateItem } from "@/server/projects/items";
import { projectErrorResponse } from "@/server/projects/errors";

export const PATCH = withAuth(async (session, req: Request, { params }) => {
  const { id, itemId } = await params;
  const body = await parseBody(req, updateItemSchema);
  if (!body.ok) return body.response;
  try {
    return Response.json({
      item: await updateItem(session.organizationId, id, itemId, body.data),
    });
  } catch (error) {
    return projectErrorResponse(error);
  }
});

export const DELETE = withAuth(async (session, _req, { params }) => {
  const { id, itemId } = await params;
  try {
    await deleteItem(session.organizationId, id, itemId);
    return Response.json({ ok: true });
  } catch (error) {
    return projectErrorResponse(error);
  }
});
