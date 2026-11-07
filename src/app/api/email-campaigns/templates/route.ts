import { apiError, parseBody, withAuth } from "@/lib/api";
import { createEmailTemplateSchema } from "@/server/email-campaigns/schema";
import {
  createEmailTemplate,
  EmailTemplateError,
  listEmailTemplates,
} from "@/server/email-campaigns/templates";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const templates = await listEmailTemplates(session.organizationId);
  return Response.json({ templates });
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createEmailTemplateSchema);
  if (!body.ok) return body.response;
  try {
    const template = await createEmailTemplate({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      data: body.data,
    });
    return Response.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof EmailTemplateError) {
      return apiError(error.status, error.code, error.message);
    }
    throw error;
  }
});
