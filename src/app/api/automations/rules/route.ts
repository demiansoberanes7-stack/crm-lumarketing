import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getIntegration, upsertIntegration } from "@/server/integrations";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const integration = await getIntegration(session.organizationId, "automation_rules");
  return NextResponse.json({ rules: integration?.credentials?.rules || null });
});

export const POST = withAuth(async (session, req: Request) => {
  const { rules } = await req.json();
  await upsertIntegration(session.organizationId, "automation_rules", { rules });
  return NextResponse.json({ ok: true });
});
