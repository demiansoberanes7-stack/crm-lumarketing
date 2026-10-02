import { NextResponse } from "next/server";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { scoped } from "@/lib/db/tenant";
import { getIntegration } from "@/server/integrations";
import { findAutomationRule } from "@/server/automation-rules";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * POST /api/automations/followup
 * Manually trigger a follow-up workflow for a given conversation.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, z.object({
    conversationId: z.string().min(1).max(255),
    delayHours: z.number().int().min(0).max(8760).optional(),
  }));
  if (!body.ok) return body.response;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.conversation)
    .where(scoped(schema.conversation.organizationId, session.organizationId, eq(schema.conversation.id, body.data.conversationId)))
    .limit(1);

  const conv = rows[0];
  if (!conv) {
    return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
  }

  const integration = await getIntegration(session.organizationId, "automation_rules");
  const rule = findAutomationRule(integration?.credentials?.rules, "followup-3d");
  const delayHours = body.data.delayHours ?? rule?.delayHours ?? 72;

  try {
    const { getTemporalClient } = await import("@/server/temporal/client");
    const client = await getTemporalClient();
    const workflowId = `followup-manual-${body.data.conversationId}-${Date.now()}`;
    await client.workflow.start("followUpWorkflow", {
      args: [body.data.conversationId, session.organizationId, delayHours],
      taskQueue: "crm-followups",
      workflowId,
    });
    return NextResponse.json({ ok: true, workflowId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If Temporal is not running, return a soft error (non-breaking)
    return NextResponse.json(
      { ok: false, error: "Temporal no disponible: " + msg },
      { status: 503 }
    );
  }
});
