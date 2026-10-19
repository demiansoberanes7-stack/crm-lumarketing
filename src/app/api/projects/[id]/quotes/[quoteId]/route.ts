import { withAuth } from "@/lib/api";
import { unlinkProjectQuote } from "@/server/projects/quotes";
import { projectErrorResponse } from "@/server/projects/errors";

export const dynamic = "force-dynamic";

/** Desanidar: quita el vínculo, no borra la cotización ni el proyecto. */
export const DELETE = withAuth(async (session, _req, { params }) => {
  const { id, quoteId } = await params;
  try {
    await unlinkProjectQuote(session.organizationId, id, quoteId);
    return Response.json({ ok: true });
  } catch (error) {
    return projectErrorResponse(error);
  }
});
