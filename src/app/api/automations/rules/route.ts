import { NextResponse } from "next/server";
import { parseBody, withAuth } from "@/lib/api";
import { getIntegration, saveIntegration } from "@/server/integrations";
import { z } from "zod";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const integration = await getIntegration(session.organizationId, "automation_rules");
  const rules = integration?.credentials?.rules;
  return NextResponse.json({ rules: Array.isArray(rules) ? rules : null });
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, z.object({
    rules: z.array(z.object({
      id: z.string().trim().min(1).max(80),
      name: z.string().trim().min(1).max(120),
      trigger: z.string().trim().min(1).max(240),
      messageText: z.string().trim().min(1).max(5000),
      delayHours: z.number().int().min(0).max(8760),
      enabled: z.boolean(),
      channel: z.enum(["whatsapp", "email"]).default("whatsapp"),
    }).strict()).min(1).max(50),
  }));
  if (!body.ok) return body.response;
  await saveIntegration(session.organizationId, "automation_rules", { rules: body.data.rules });
  return NextResponse.json({ ok: true });
});
