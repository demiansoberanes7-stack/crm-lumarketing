import { parseBody, withAuth } from "@/lib/api";
import { linkQuoteSchema } from "@/lib/project-contract";
import { getProject } from "@/server/projects/service";
import { linkProjectQuote, listProjectQuotes } from "@/server/projects/quotes";
import { ProjectError, projectErrorResponse } from "@/server/projects/errors";

export const dynamic = "force-dynamic";

/** Cotizaciones anidadas en el proyecto. */
export const GET = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  try {
    if (!(await getProject(session.organizationId, id)))
      throw new ProjectError(404, "Proyecto no encontrado");
    return Response.json({ quotes: await listProjectQuotes(session.organizationId, id) });
  } catch (error) {
    return projectErrorResponse(error);
  }
});

/** Anidar una cotización existente (sin crear proyecto nuevo). */
export const POST = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, linkQuoteSchema);
  if (!body.ok) return body.response;
  try {
    if (!(await getProject(session.organizationId, id)))
      throw new ProjectError(404, "Proyecto no encontrado");
    const { alreadyLinked } = await linkProjectQuote(
      session.organizationId,
      id,
      body.data.quoteId
    );
    return Response.json(
      { ok: true, alreadyLinked, quotes: await listProjectQuotes(session.organizationId, id) },
      { status: alreadyLinked ? 200 : 201 }
    );
  } catch (error) {
    return projectErrorResponse(error);
  }
});
