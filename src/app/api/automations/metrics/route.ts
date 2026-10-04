import { withAuth } from "@/lib/api";
import { getAutomationMetrics } from "@/server/automation-queue";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const metrics = await getAutomationMetrics(session.organizationId);
  return Response.json({ metrics });
});
