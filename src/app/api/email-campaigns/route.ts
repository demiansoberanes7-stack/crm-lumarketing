import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  createEmailCampaign,
  EmailCampaignError,
  listEmailCampaigns,
  listSenderAccounts,
} from "@/server/email-campaigns/service";
import { createEmailCampaignSchema } from "@/server/email-campaigns/schema";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const [campaigns, accounts] = await Promise.all([
    listEmailCampaigns(session.organizationId),
    listSenderAccounts(session.organizationId),
  ]);
  return Response.json({ campaigns, accounts });
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createEmailCampaignSchema);
  if (!body.ok) return body.response;
  try {
    const campaign = await createEmailCampaign({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      data: body.data,
    });
    return Response.json({ campaign }, { status: 201 });
  } catch (error) {
    if (error instanceof EmailCampaignError) {
      return apiError(error.status, error.code, error.message);
    }
    throw error;
  }
});
