import { apiError, withAuth } from "@/lib/api";
import {
  deleteEmailTemplate,
  getEmailTemplate,
} from "@/server/email-campaigns/templates";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const template = await getEmailTemplate(session.organizationId, id);
  if (!template) return apiError(404, "not_found", "Plantilla no encontrada");
  return Response.json({ template });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const deleted = await deleteEmailTemplate(session.organizationId, id);
  if (!deleted) return apiError(404, "not_found", "Plantilla no encontrada");
  return Response.json({ ok: true });
});
